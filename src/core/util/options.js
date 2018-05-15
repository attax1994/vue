/* @flow */

import config from '../config'
import {warn} from './debug'
import {nativeWatch} from './env'
import {set} from '../observer/index'

import {
  ASSET_TYPES,
  LIFECYCLE_HOOKS,
} from '../../shared/constants'

import {
  extend,
  hasOwn,
  camelize,
  toRawType,
  capitalize,
  isBuiltInTag,
  isPlainObject,
} from '../../shared/util'

/**
 * Option overwriting strategies are functions that handle
 * how to merge a parent option value and a child option
 * value into the final value.
 */
// 覆盖原设置的策略
const strats = config.optionMergeStrategies

/**
 * Options with restrictions
 */
// 受约束的设置
if (process.env.NODE_ENV !== 'production') {
  strats.el = strats.propsData = function (parent, child, vm, key) {
    if (!vm) {
      warn(
        `option "${key}" can only be used during instance ` +
        'creation with the `new` keyword.',
      )
    }
    return defaultStrat(parent, child)
  }
}

// 默认策略
const defaultStrat = function (parentVal: any, childVal: any): any {
  return childVal === undefined
    ? parentVal
    : childVal
}

// 将两个对象合并，碰到引用类型的情况，对其进行递归合并
function mergeData(to: Object, from: ?Object): Object {
  if (!from) return to
  let key, toVal, fromVal
  const keys = Object.keys(from)
  for (let i = 0; i < keys.length; i++) {
    key = keys[i]
    toVal = to[key]
    fromVal = from[key]

    if (!hasOwn(to, key)) {
      // 对于新加入的属性，手动触发Vue.set
      set(to, key, fromVal)
    } else if (isPlainObject(toVal) && isPlainObject(fromVal)) {
      // 同为对象，进行递归
      mergeData(toVal, fromVal)
    }
  }
  return to
}

/**
 * Data相关处理
 */
// Vue.extend的底层实现
export function mergeDataOrFn(parentVal: any, childVal: any, vm?: Component): ?Function {
  // 没有传入vm，说明是函数的合并，返回闭包
  if (!vm) {
    // 在Vue.extend中，传入的应当为function
    if (!childVal) {
      return parentVal
    }
    if (!parentVal) {
      return childVal
    }

    // 如果parentVal和childVal同时存在，那么返回一个闭包
    // 闭包执行后返回对两个函数结果进行递归合并的对象
    return function mergedDataFn() {
      return mergeData(
        typeof childVal === 'function' ? childVal.call(this, this) : childVal,
        typeof parentVal === 'function' ? parentVal.call(this, this) : parentVal,
      )
    }
  }
  // 如果传入vm，说明是实例的合并，返回合并后的结果
  else {
    return function mergedInstanceDataFn() {
      const instanceData = typeof childVal === 'function'
        ? childVal.call(vm, vm)
        : childVal
      const defaultData = typeof parentVal === 'function'
        ? parentVal.call(vm, vm)
        : parentVal
      if (instanceData) {
        return mergeData(instanceData, defaultData)
      } else {
        return defaultData
      }
    }
  }
}

// data字段的生成策略，这一段决定了data要使用function来创建
strats.data = function (parentVal: any, childVal: any, vm?: Component): ?Function {
  if (!vm) {
    // 提示vm.data对象必须经由function来创建
    if (childVal && typeof childVal !== 'function') {
      process.env.NODE_ENV !== 'production' && warn(
        'The "data" option should be a function ' +
        'that returns a per-instance value in component ' +
        'definitions.',
        vm,
      )

      return parentVal
    }
    return mergeDataOrFn(parentVal, childVal)
  }

  return mergeDataOrFn(parentVal, childVal, vm)
}

/**
 * 合并生命周期钩子，返回形式为Array
 */
function mergeHook(parentVal: ?Array<Function>, childVal: ?Function | ?Array<Function>): ?Array<Function> {
  return childVal
    ? parentVal
      ? parentVal.concat(childVal)
      : Array.isArray(childVal)
        ? childVal
        : [childVal]
    : parentVal
}

LIFECYCLE_HOOKS.forEach(hook => {
  strats[hook] = mergeHook
})

/**
 * Assets
 * Assets指component，directive和filter
 * 创建vm时，要进行三方面的options合并，包括构造器options，实例options和父级options
 */
function mergeAssets(parentVal: ?Object, childVal: ?Object, vm?: Component, key: string): Object {
  // 父级放置于原型链上，做对象委托
  const res = Object.create(parentVal || null)
  if (childVal) {
    // 提示类型是否正确
    process.env.NODE_ENV !== 'production' && assertObjectType(key, childVal, vm)
    // 执行merge
    return extend(res, childVal)
  } else {
    return res
  }
}

ASSET_TYPES.forEach(function (type) {
  strats[type + 's'] = mergeAssets
})

/**
 * Watchers.
 * 要保证相同哈希值的Watcher不会去覆盖另一个，就得使用Array的形式
 */
strats.watch = function (parentVal: ?Object, childVal: ?Object, vm?: Component, key: string): ?Object {
  // 绕过FireFox的Object.prototype.watch问题
  if (parentVal === nativeWatch) parentVal = undefined
  if (childVal === nativeWatch) childVal = undefined

  if (!childVal) return Object.create(parentVal || null)
  if (process.env.NODE_ENV !== 'production') {
    assertObjectType(key, childVal, vm)
  }
  if (!parentVal) return childVal

  const ret = {}
  extend(ret, parentVal)

  // 使用Array来记录watcher，不是Array就做转换
  for (const key in childVal) {
    let parent = ret[key]
    const child = childVal[key]
    if (parent && !Array.isArray(parent)) {
      parent = [parent]
    }
    ret[key] = parent
      ? parent.concat(child)
      : Array.isArray(child) ? child : [child]
  }
  return ret
}

/**
 * 其他对象的哈希合并，可以直接覆盖
 */
strats.props =
  strats.methods =
    strats.inject =
      strats.computed = function (parentVal: ?Object, childVal: ?Object, vm?: Component, key: string): ?Object {
        if (childVal && process.env.NODE_ENV !== 'production') {
          assertObjectType(key, childVal, vm)
        }
        if (!parentVal) return childVal
        const ret = Object.create(null)
        extend(ret, parentVal)
        if (childVal) extend(ret, childVal)
        return ret
      }
strats.provide = mergeDataOrFn


/**
 * 检查components引入的子组件名称是否合法
 */
function checkComponents(options: Object) {
  for (const key in options.components) {
    validateComponentName(key)
  }
}

// 验证组件名称，这一段决定了组件名必须以字母开头，并只能使用字母和连字符
export function validateComponentName(name: string) {
  if (!/^[a-zA-Z][\w-]*$/.test(name)) {
    warn(
      'Invalid component name: "' + name + '". Component names ' +
      'can only contain alphanumeric characters and the hyphen, ' +
      'and must start with a letter.',
    )
  }
  if (isBuiltInTag(name) || config.isReservedTag(name)) {
    warn(
      'Do not use built-in or reserved HTML elements as component ' +
      'id: ' + name,
    )
  }
}

/**
 * 保证props的写法规整为Object的形式，且内部每个prop都转换为Object
 */
function normalizeProps(options: Object, vm: ?Component) {
  const props = options.props
  if (!props) return

  const res = {}
  let i, val, name
  // 如果是Array<string>，则转为Object，其键为每个string驼峰式的写法
  if (Array.isArray(props)) {
    i = props.length
    while (i--) {
      val = props[i]
      if (typeof val === 'string') {
        name = camelize(val)
        res[name] = {type: null}
      } else if (process.env.NODE_ENV !== 'production') {
        warn('props must be strings when using array syntax.')
      }
    }
  }
  // 如果是Object，只需转换一下非对象形式声明的prop
  else if (isPlainObject(props)) {
    for (const key in props) {
      val = props[key]
      name = camelize(key)
      res[name] = isPlainObject(val)
        ? val
        : {type: val}
    }
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
      `but got ${toRawType(props)}.`,
      vm,
    )
  }
  options.props = res
}

/**
 * 将Injections的写法规整为Object的形式
 */
function normalizeInject(options: Object, vm: ?Component) {
  const inject = options.inject
  if (!inject) return
  const normalized = options.inject = {}
  if (Array.isArray(inject)) {
    for (let i = 0; i < inject.length; i++) {
      normalized[inject[i]] = {from: inject[i]}
    }
  } else if (isPlainObject(inject)) {
    for (const key in inject) {
      const val = inject[key]
      normalized[key] = isPlainObject(val)
        ? extend({from: key}, val)
        : {from: val}
    }
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "inject": expected an Array or an Object, ` +
      `but got ${toRawType(inject)}.`,
      vm,
    )
  }
}

/**
 * 将函数形式的directives的写法规整为Object的形式
 */
function normalizeDirectives(options: Object) {
  const dirs = options.directives
  if (dirs) {
    for (const key in dirs) {
      const def = dirs[key]
      if (typeof def === 'function') {
        dirs[key] = {bind: def, update: def}
      }
    }
  }
}


// 断言是否为Object
function assertObjectType(name: string, value: any, vm: ?Component) {
  if (!isPlainObject(value)) {
    warn(
      `Invalid value for option "${name}": expected an Object, ` +
      `but got ${toRawType(value)}.`,
      vm,
    )
  }
}

/**
 * 合并两个option对象，包括props，Injections和directive的合并
 */
export function mergeOptions(parent: Object, child: Object, vm?: Component): Object {
  if (process.env.NODE_ENV !== 'production') {
    checkComponents(child)
  }

  if (typeof child === 'function') {
    child = child.options
  }

  // 规整三个字段
  normalizeProps(child, vm)
  normalizeInject(child, vm)
  normalizeDirectives(child)

  // 如果有一些特殊继承规则，则先对父级进行预处理
  const extendsFrom = child.extends
  if (extendsFrom) {
    parent = mergeOptions(parent, extendsFrom, vm)
  }
  if (child.mixins) {
    for (let i = 0, l = child.mixins.length; i < l; i++) {
      parent = mergeOptions(parent, child.mixins[i], vm)
    }
  }

  // 合并各个字段
  const options = {}
  let key
  for (key in parent) {
    mergeField(key)
  }
  for (key in child) {
    if (!hasOwn(parent, key)) {
      mergeField(key)
    }
  }

  // 套用合并策略，进行某个字段的合并
  function mergeField(key) {
    const strat = strats[key] || defaultStrat
    options[key] = strat(parent[key], child[key], vm, key)
  }

  return options
}

/**
 * 检查options中是否有某个asset（component，directive，filter）
 * 指示子组件实例是否要访问其上层链中定义的asset
 */
export function resolveAsset(options: Object, type: string, id: string, warnMissing?: boolean): any {
  if (typeof id !== 'string') {
    return
  }
  const assets = options[type]
  // 用三种拼写形式去检查，
  if (hasOwn(assets, id)) return assets[id]
  const camelizedId = camelize(id)
  if (hasOwn(assets, camelizedId)) return assets[camelizedId]
  const PascalCaseId = capitalize(camelizedId)
  if (hasOwn(assets, PascalCaseId)) return assets[PascalCaseId]

  const res = assets[id] || assets[camelizedId] || assets[PascalCaseId]
  if (process.env.NODE_ENV !== 'production' && warnMissing && !res) {
    warn(
      'Failed to resolve ' + type.slice(0, -1) + ': ' + id,
      options,
    )
  }
  return res
}

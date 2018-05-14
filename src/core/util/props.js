/* @flow */

import {warn} from './debug'
import {observe, toggleObserving, shouldObserve} from '../observer/index'
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject,
} from '../../shared/util'

// property的选项（注册props时候填写）
type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function
};


/**
 * 将某个Prop合法化，即检查是否符合prop描述，获得默认值，然后加入观察
 */
export function validateProp(key: string, propOptions: Object, propsData: Object, vm?: Component): any {
  const prop = propOptions[key]
  // 检查该prop是否存在
  const absent = !hasOwn(propsData, key)
  let value = propsData[key]
  // 在prop.type中寻找Boolean类型对应的索引
  const booleanIndex = getTypeIndex(Boolean, prop.type)

  // 如果有Boolean类型
  if (booleanIndex > -1) {
    // default没设置，默认为false
    if (absent && !hasOwn(prop, 'default')) {
      value = false
    }
    // 带有string，但是Boolean靠前，将空字符串转为true
    else if (value === '' || value === hyphenate(key)) {
      const stringIndex = getTypeIndex(String, prop.type)
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true
      }
    }
  }

  // 检查默认值
  if (value === undefined) {
    // 获取默认值，主要是针对引用类型的处理
    value = getPropDefaultValue(vm, prop, key)
    // 将该Prop纳入观察
    const prevShouldObserve = shouldObserve
    toggleObserving(true)
    observe(value)
    toggleObserving(prevShouldObserve)
  }

  // 非生产环境下，验证该prop的类型、required、validator，对有问题的地方进行断言
  if (
    process.env.NODE_ENV !== 'production' &&
    // Weex下跳过检查
    !(__WEEX__ && isObject(value) && ('@binding' in value))
  ) {
    assertProp(prop, key, value, vm, absent)
  }
  return value
}

/**
 * 获取某个Prop的默认值。
 * 注意引用类型要使用工厂模式，然后执行返回
 */
function getPropDefaultValue(vm: ?Component, prop: PropOptions, key: string): any {
  // 没有设置default，则为undefined
  if (!hasOwn(prop, 'default')) {
    return undefined
  }

  const def = prop.default
  // 提示Object和Array要用工厂模式来生成，例如 ()=>[]
  if (process.env.NODE_ENV !== 'production' && isObject(def)) {
    warn(
      'Invalid default value for prop "' + key + '": ' +
      'Props with type Object/Array must use a factory function ' +
      'to return the default value.',
      vm,
    )
  }

  // 如果一开始propsData[key]为undefined，直接返回_props[key]，防止触发watcher
  if (vm && vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    return vm._props[key]
  }

  // 针对引用类型的工厂模式，执行后返回该对象
  return typeof def === 'function' && getType(prop.type) !== 'Function'
    ? def.call(vm)
    : def
}

/**
 * 断言某个prop是否有效
 */
function assertProp(
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean,
) {
  // 声明了required却没有使用的，发出警告
  if (prop.required && absent) {
    warn(
      'Missing required prop: "' + name + '"',
      vm,
    )
    return
  }
  if (value == null && !prop.required) {
    return
  }
  let type = prop.type
  let valid = !type || type === true
  const expectedTypes = []

  // 检查每个类型，查看value是否符合其中一个
  if (type) {
    if (!Array.isArray(type)) {
      type = [type]
    }
    for (let i = 0; i < type.length && !valid; i++) {
      const assertedType = assertType(value, type[i])
      expectedTypes.push(assertedType.expectedType || '')
      valid = assertedType.valid
    }
  }

  // 类型不合法，发出警告
  if (!valid) {
    warn(
      `Invalid prop: type check failed for prop "${name}".` +
      ` Expected ${expectedTypes.map(capitalize).join(', ')}` +
      `, got ${toRawType(value)}.`,
      vm,
    )
    return
  }

  // 套用validator，检查value是否合法
  const validator = prop.validator
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm,
      )
    }
  }
}

/**
 * 检查value是否符合某个类型
 */
const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol)$/
function assertType(value: any, type: Function): {
  valid: boolean;
  expectedType: string;
} {
  let valid
  const expectedType = getType(type)
  // 基本类型的处理
  if (simpleCheckRE.test(expectedType)) {
    const t = typeof value
    valid = t === expectedType.toLowerCase()

    // 也有可能是基本类型构造器的实例
    if (!valid && t === 'object') {
      valid = value instanceof type
    }
  }
  // 如果是Object，则检查value是否为纯Object
  else if (expectedType === 'Object') {
    valid = isPlainObject(value)
  }
  // 如果是Array，检查value是否为Array
  else if (expectedType === 'Array') {
    valid = Array.isArray(value)
  }
  // 如果都不是，检查value是否为type的实例
  else {
    valid = value instanceof type
  }
  return {
    valid,
    expectedType,
  }
}


/**
 * 使用类型构造器的函数名来检查类型
 */
// 调取函数名（或是class类名）
function getType(fn) {
  const match = fn && fn.toString().match(/^\s*function (\w+)/)
  return match ? match[1] : ''
}

// 检查类名是否相同，从而确认为相同类
function isSameType(a, b) {
  return getType(a) === getType(b)
}

// 获取指定类型的索引
function getTypeIndex(type, expectedTypes): number {
  // 如果expectedTypes不是Array，也就是只传入了一个类型，检查类名
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1
  }
  // 如果expectedTypes是Array，遍历expectedTypes来查找type
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i
    }
  }
  return -1
}

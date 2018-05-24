/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import {pushTarget, popTarget} from '../observer/dep'
import {isUpdatingChildComponent} from './lifecycle'

import {set, del, observe, defineReactive, toggleObserving} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop,
}

/**
 * 通过proxy函数将_data（或者_props等）上面的属性代理到vm上，
 * 从而直接通过 this.key 访问，而无需 this._data.key 的形式，
 * 本质上是改造vm上这个对应key的setter和getter，
 * 最终set和get操作的还是_data、_props等对象上面的属性
 */
export function proxy(target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter() {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter(val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}


/**
 * 初始化props、methods、data、computed与watch
 * @param vm
 */
export function initState(vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  // 初始化props
  if (opts.props) initProps(vm, opts.props)
  // 初始化methods
  if (opts.methods) initMethods(vm, opts.methods)
  // 初始化data，没有data时假定为空对象
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  // 初始化computed
  if (opts.computed) initComputed(vm, opts.computed)
  // 初始化watch
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}


/**
 * 初始化props
 * @param vm
 * @param propsOptions
 */
function initProps(vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}

  // 将props的key缓存在vm.$options._propKeys，props更新时可以直接遍历这个Array，而不是枚举对象属性
  const keys = vm.$options._propKeys = []

  // 如果$parent为null或undefined，说明是根节点
  const isRoot = !vm.$parent
  // 非root节点，可以在最后将shouldConvert赋值为true
  if (!isRoot) {
    toggleObserving(false)
  }

  /**
   * 将props上的属性提取到vm上
   */
  for (const key in propsOptions) {
    // 将key存入vm.$options._propKeys
    keys.push(key)
    // 验证prop
    const value = validateProp(key, propsOptions, propsData, vm)

    /**
     * 改造getter和setter，纳入观察
     */
    if (process.env.NODE_ENV !== 'production') {
      // 检查是否为保留的字段
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm,
        )
      }
      // 在setter中提示不要在子组件中直接修改props的属性，而是让父组件传入
      defineReactive(props, key, value, () => {
        if (vm.$parent && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm,
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }

    // Vue.extend()期间，静态props已经被代理到组件原型上，因此只需要代理props
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}


/**
 * 初始化methods
 * @param vm
 * @param methods
 */
function initMethods(vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      // 保证不是null或者undefined
      if (methods[key] == null) {
        warn(
          `Method "${key}" has an undefined value in the component definition. ` +
          `Did you reference the function correctly?`,
          vm,
        )
      }
      // 保证不和props的属性重名
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm,
        )
      }
      // 保证不是vm保留字段
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`,
        )
      }
    }
    // 方法可以直接挂载，无需proxy，注意bind它的this指针到vm实例
    vm[key] = methods[key] == null ? noop : bind(methods[key], vm)
  }
}


/**
 * 初始化data
 * @param vm
 */
function initData(vm: Component) {
  let data = vm.$options.data
  /**
   * data通常应当为function，执行后得到返回对象
   */
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm,
    )
  }

  /**
   * 将data代理到vm实例上，
   */
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    // 保证不与methods中的属性重名
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm,
        )
      }
    }
    // 保证不与props中的属性重名
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm,
      )
    }
    // 保证不是vm的保留字段
    else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }

  // 将data加入观察
  observe(data, true /* asRootData */)
}

export function getData(data: Function, vm: Component): any {
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}


const computedWatcherOptions = {computed: true}

/**
 * 初始化computed
 * @param vm
 * @param computed
 */
function initComputed(vm: Component, computed: Object) {
  const watchers = vm._computedWatchers = Object.create(null)
  const isSSR = isServerRendering()

  /**
   * 计算属性可能是一个function，也有可能设置了get以及set的对象，
   */
  for (const key in computed) {
    const userDef = computed[key]
    /**
     * 只是一个function，说明只有getter，否则就要从对象中提取get
     */
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm,
      )
    }

    if (!isSSR) {
      /**
       * 为computed的属性创建内部watcher，保存在vm实例的_computedWatchers中
       * 这里的computedWatcherOptions参数传递了computed: true
       */
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions,
      )
    }

    // 避免重复定义同名的属性
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}

/**
 * 定义单个computed属性
 * @param target
 * @param key
 * @param userDef
 */
export function defineComputed(target: any, key: string, userDef: Object | Function) {
  // SSR情况下无需watch
  const shouldCache = !isServerRendering()

  /**
   * 单传function，就是只有get
   * getter会被进行改造，
   * 调用对应watcher的depend()方法进行依赖收集，调用evaluate()方法返回最新的值
   */
  if (typeof userDef === 'function') {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : userDef
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : userDef.get
      : noop
    sharedPropertyDefinition.set = userDef.set
      ? userDef.set
      : noop
  }
  // 没有定义setter的时候，给一个默认的setter，提示不能对它进行set
  if (process.env.NODE_ENV !== 'production' &&
    sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this,
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

/**
 * 创建计算属性的getter
 * @param key
 * @return value
 */
function createComputedGetter(key) {
  return function computedGetter() {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      // 依赖收集
      watcher.depend()
      // 脏检查，获取最新的数值
      return watcher.evaluate()
    }
  }
}


/**
 * 初始化watch属性，其handler支持Function和Array<Function>形式
 * @param vm
 * @param watch
 */
function initWatch(vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key]
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

/**
 * 创建单个watch，利用Vue.prototype.$watch()方法来进行监测
 * @param vm
 * @param expOrFn
 * @param handler
 * @param options
 * @return {Function}
 */
function createWatcher(vm: Component, expOrFn: string | Function, handler: any, options?: Object) {
  // 对对象形式的handler做解包
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  // 对字符串形式的handler，认为它是一个key，从vm上找到对应的method
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  return vm.$watch(expOrFn, handler, options)
}


/**
 * state的混入
 * @param Vue
 */
export function stateMixin(Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () {
    return this._data
  }
  const propsDef = {}
  propsDef.get = function () {
    return this._props
  }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function (newData: Object) {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this,
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  Vue.prototype.$watch = function (expOrFn: string | Function, cb: any, options?: Object): Function {
    const vm: Component = this
    // 对象形式的callback，让createWatcher()去解包
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }

    options = options || {}
    options.user = true

    // 给它建立一个watcher，做监测
    const watcher = new Watcher(vm, expOrFn, cb, options)

    // 设置immediate: true的时候会立即执行一次
    if (options.immediate) {
      cb.call(vm, watcher.value)
    }

    // 返回unwatch()的方法，用于解除这个watch，停止触发回调
    return function unwatchFn() {
      watcher.teardown()
    }
  }
}

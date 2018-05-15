/* @flow */

import {
  tip,
  toArray,
  hyphenate,
  handleError,
  formatComponentName,
} from '../util/index'
import {updateListeners} from '../vdom/helpers/index'

/**
 * 初始化输入vm的事件机制
 */
export function initEvents(vm: Component) {
  // 空对象记录注册的事件，作为字典
  vm._events = Object.create(null)
  // 标志位来表明是否存在钩子，而不需要通过哈希表的方法来查找是否有钩子，这样做可以减少不必要的开销，优化性能
  vm._hasHookEvent = false

  // 获取父组件的监听器（涉及到组件间通信）
  const listeners = vm.$options._parentListeners
  // 如果父组件有监听器，就需要做初始的更新，
  if (listeners) {
    updateComponentListeners(vm, listeners)
  }
}

let target: any

// 添加一个事件
function add(event, fn, once) {
  if (once) {
    target.$once(event, fn)
  } else {
    target.$on(event, fn)
  }
}

// 移除一个事件
function remove(event, fn) {
  target.$off(event, fn)
}

// 更新组件的监听器
export function updateComponentListeners(vm: Component, listeners: Object, oldListeners: ?Object) {
  target = vm
  updateListeners(listeners, oldListeners || {}, add, remove, vm)
  target = undefined
}

/**
 * 事件机制混入到Vue的原型链上
 */
export function eventsMixin(Vue: Class<Component>) {
  const hookRE = /^hook:/

  // Vue.$on实现，添加一个事件回调
  Vue.prototype.$on = function (event: string | Array<string>, fn: Function): Component {
    const vm: Component = this

    if (Array.isArray(event)) {
      // 对Array进行遍历，逐个递归处理
      for (let i = 0, l = event.length; i < l; i++) {
        this.$on(event[i], fn)
      }
    }
    else {
      // 加入对应名称的事件数组
      (vm._events[event] || (vm._events[event] = [])).push(fn)

      // 判断是否为钩子事件，进行对应置位
      if (hookRE.test(event)) {
        vm._hasHookEvent = true
      }
    }
    return vm
  }

  // Vue.$off实现，移除某个事件回调
  Vue.prototype.$off = function (event?: string | Array<string>, fn?: Function): Component {
    const vm: Component = this

    // 不传参数，移除所有监听器
    if (!arguments.length) {
      // 把_events字典整个替换
      vm._events = Object.create(null)
      return vm
    }

    // 传入数组，遍历拆分后逐个递归处理
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        this.$off(event[i], fn)
      }
      return vm
    }

    // 对于明确的单个事件移除
    const cbs = vm._events[event]
    if (!cbs) {
      return vm
    }
    // 没有传入具体的handler，则删除该event名称下所有回调
    if (!fn) {
      vm._events[event] = null
      return vm
    }
    // 删除某个指明的handler
    if (fn) {
      let cb
      let i = cbs.length
      // 遍历该类型的callbacks，找到后splice()删除
      while (i--) {
        cb = cbs[i]
        if (cb === fn || cb.fn === fn) {
          cbs.splice(i, 1)
          break
        }
      }
    }
    return vm
  }

  // Vue.$once实现，只执行一次
  Vue.prototype.$once = function (event: string, fn: Function): Component {
    const vm: Component = this

    // 对原本的执行做一层闭包，先移除该监听器，后执行回调，保证了只执行一次
    function on() {
      vm.$off(event, on)
      fn.apply(vm, arguments)
    }

    on.fn = fn
    vm.$on(event, on)
    return vm
  }

  // Vue.$emit实现，触发某个事件
  Vue.prototype.$emit = function (event: string): Component {
    const vm: Component = this

    // 提示使用event名称小写，可以结合烤肉串命名法
    if (process.env.NODE_ENV !== 'production') {
      const lowerCaseEvent = event.toLowerCase()
      if (lowerCaseEvent !== event && vm._events[lowerCaseEvent]) {
        tip(
          `Event "${lowerCaseEvent}" is emitted in component ` +
          `${formatComponentName(vm)} but the handler is registered for "${event}". ` +
          `Note that HTML attributes are case-insensitive and you cannot use ` +
          `v-on to listen to camelCase events when using in-DOM templates. ` +
          `You should probably use "${hyphenate(event)}" instead of "${event}".`,
        )
      }
    }

    // 遍历该类型下所有handler，逐个执行
    let cbs = vm._events[event]
    if (cbs) {
      cbs = cbs.length > 1 ? toArray(cbs) : cbs
      const args = toArray(arguments, 1)
      for (let i = 0, l = cbs.length; i < l; i++) {
        try {
          cbs[i].apply(vm, args)
        } catch (e) {
          handleError(e, vm, `event handler for "${event}"`)
        }
      }
    }
    return vm
  }
}

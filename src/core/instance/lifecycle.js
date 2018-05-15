/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import {mark, measure} from '../util/perf'
import {createEmptyVNode} from '../vdom/vnode'
import {updateComponentListeners} from './events'
import {resolveSlots} from './render-helpers/resolve-slots'
import {toggleObserving} from '../observer/index'
import {pushTarget, popTarget} from '../observer/dep'

import {
  warn,
  noop,
  remove,
  handleError,
  emptyObject,
  validateProp,
} from '../util/index'

export let activeInstance: any = null
export let isUpdatingChildComponent: boolean = false

// 初始化生命周期
export function initLifecycle(vm: Component) {
  const options = vm.$options

  // 将vm对象存储到parent组件中，如果是非抽象组件，需要存储到最近一层的非抽象父级上
  let parent = options.parent
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent
    }
    parent.$children.push(vm)
  }

  // 设置组件间关系描述属性
  vm.$parent = parent
  vm.$root = parent ? parent.$root : vm
  vm.$children = []

  // 用于记录组件内的使用的属性
  vm.$refs = {}
  vm._watcher = null
  vm._inactive = null

  // 生命周期状态
  vm._directInactive = false
  vm._isMounted = false
  vm._isDestroyed = false
  vm._isBeingDestroyed = false
}

// 混入生命周期
export function lifecycleMixin(Vue: Class<Component>) {
  // 更新节点
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    const prevActiveInstance = activeInstance

    // 载入当前状态
    activeInstance = vm
    vm._vnode = vnode

    //基于后端渲染Vue.prototype.__patch__被用来作为一个入口
    if (!prevVnode) {
      // 没有prevVnode，说明是初次渲染，初始化render
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */)
    } else {
      // 更新节点
      vm.$el = vm.__patch__(prevVnode, vnode)
    }

    // 恢复activeInstance
    activeInstance = prevActiveInstance

    // 更新实例的__vue__
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }

    // 如果父级是高阶组件，更新其$el
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el
    }
    // updated钩子由scheduler来触发，保证子组件在父组件的updated钩子中更新
  }


  // Vue.$forceUpdate实现，强制进行更新
  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this
    // 调用其watcher的更新方法
    if (vm._watcher) {
      vm._watcher.update()
    }
  }

  // Vue.$destroy实现，完全销毁一个实例，清理它与其它实例的连接，解绑它的全部指令及事件监听器。
  Vue.prototype.$destroy = function () {
    const vm: Component = this

    // 避免重复触发$destroy
    if (vm._isBeingDestroyed) {
      return
    }
    // 触发beforeDestroy钩子
    callHook(vm, 'beforeDestroy')
    vm._isBeingDestroyed = true

    // 从父级中移除自身
    const parent = vm.$parent
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm)
    }

    // 该组件下的所有Watcher从其所在的Dep中释放
    if (vm._watcher) {
      vm._watcher.teardown()
    }
    let i = vm._watchers.length
    while (i--) {
      vm._watchers[i].teardown()
    }

    // 移除data被观察的引用
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--
    }

    // _isDestroyed状态置位
    vm._isDestroyed = true
    // Vnode置空
    vm.__patch__(vm._vnode, null)

    // 触发destroyed钩子
    callHook(vm, 'destroyed')

    // 将该vm上的所有事件监听器清除
    vm.$off()

    // 清除实例的__vue__
    if (vm.$el) {
      vm.$el.__vue__ = null
    }

    // 释放环形引用（否则不能释放内存）
    if (vm.$vnode) {
      vm.$vnode.parent = null
    }
  }
}

// 挂载组件
export function mountComponent(vm: Component, el: ?Element, hydrating?: boolean): Component {
  vm.$el = el
  if (!vm.$options.render) {
    // render函数不存在的时候创建一个空的VNode节点
    vm.$options.render = createEmptyVNode

    if (process.env.NODE_ENV !== 'production') {
      if ((vm.$options.template && vm.$options.template.charAt(0) !== '#') || vm.$options.el || el) {
        warn(
          'You are using the runtime-only build of Vue where the template ' +
          'compiler is not available. Either pre-compile the templates into ' +
          'render functions, or use the compiler-included build.',
          vm,
        )
      } else {
        warn(
          'Failed to mount component: template or render function not defined.',
          vm,
        )
      }
    }
  }

  // 触发beforeMount钩子
  callHook(vm, 'beforeMount')

  // updateComponent作为Watcher对象的getter函数，用来依赖收集
  let updateComponent

  // 非生产环境下做performance的mark
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      const vnode = vm._render()
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      vm._update(vnode, hydrating)
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }
  }

  // 注册一个Watcher实例，
  // Watcher的getter为updateComponent函数，用于触发所有渲染所需要用到的数据的getter，进行依赖收集
  // 该Watcher实例会存在所有渲染所需数据的闭包Dep中
  new Watcher(vm, updateComponent, noop, {
    before() {
      if (vm._isMounted) {
        callHook(vm, 'beforeUpdate')
      }
    },
  }, true /* isRenderWatcher */)
  hydrating = false

  // 触发mounted钩子，此时instance已经存在，$vnode还没有渲染
  if (vm.$vnode == null) {
    vm._isMounted = true
    callHook(vm, 'mounted')
  }
  return vm
}

// 更新子组件
export function updateChildComponent(
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>,
) {
  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = true
  }

  // 判断组件是否有slot子组件，需要在覆盖$options._renderChildren完成
  const hasChildren = !!(
    renderChildren ||               // has new static slots
    vm.$options._renderChildren ||  // has old static slots
    parentVnode.data.scopedSlots || // has new scoped slots
    vm.$scopedSlots !== emptyObject // has old scoped slots
  )

  vm.$options._parentVnode = parentVnode
  vm.$vnode = parentVnode // 在无需重新渲染情况下，更新占位的节点

  if (vm._vnode) { // 更新子组件_vnode.parent的引用
    vm._vnode.parent = parentVnode
  }
  vm.$options._renderChildren = renderChildren

  // 更新$attrs和$listeners。它们本身是响应式的，所以如果子组件有使用它们，可能触发子组件的更新
  vm.$attrs = parentVnode.data.attrs || emptyObject
  vm.$listeners = listeners || emptyObject

  // 更新props
  if (propsData && vm.$options.props) {
    toggleObserving(false)
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      const propOptions: any = vm.$options.props

      // 使用core/util/props的validateProp()来验证其是否有效
      props[key] = validateProp(key, propOptions, propsData, vm)
    }
    toggleObserving(true)
    // 保存原始propsData
    vm.$options.propsData = propsData
  }

  // 更新事件监听器
  listeners = listeners || emptyObject
  const oldListeners = vm.$options._parentListeners
  vm.$options._parentListeners = listeners
  updateComponentListeners(vm, listeners, oldListeners)

  // 如果有子组件，利用core/instance/render-helpers/resolve-slots.js的resolveSlots()来处理slot子组件，并触发一次强制更新
  if (hasChildren) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }

  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = false
  }
}

// 判断组件是否active
function isInInactiveTree(vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true
  }
  return false
}

// 使所有子组件状态都变成active ,同时分别触发其activated钩子
export function activateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    // 已经active了，就避免重复执行
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    callHook(vm, 'activated')
  }
}

// 使所有子组件状态都变成inactive ,同时分别触发其deactivated钩子
export function deactivateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}

// 调用钩子函数并且触发钩子事件
export function callHook(vm: Component, hook: string) {
  pushTarget()

  // 从vm上获取到对应hook的回调
  const handlers = vm.$options[hook]

  // 遍历执行对应的回调函数
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      try {
        handlers[i].call(vm)
      } catch (e) {
        handleError(e, vm, `${hook} hook`)
      }
    }
  }

  // 对于有hook事件的，发射hook事件
  if (vm._hasHookEvent) {
    vm.$emit('hook:' + hook)
  }

  popTarget()
}

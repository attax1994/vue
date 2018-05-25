/* @flow */

import {warn, remove, isObject, parsePath, _Set as Set, handleError} from '../util/index'

import {traverse} from './traverse'
import {queueWatcher} from './scheduler'
import Dep, {pushTarget, popTarget} from './dep'

import type {SimpleSet} from '../util/index'

let uid = 0

/**
 * watcher负责解析表达式，收集依赖，并在表达式的值改变时触发回调。
 * 它能被用在vm.$watch()或是指令系统。
 */
export default class Watcher {
  // 观察的vm实例
  vm: Component
  // 表达式
  expression: string
  // 回调
  cb: Function
  // 这个watcher的id
  id: number
  // 指示是否为深度模式
  deep: boolean
  user: boolean
  // 指示是否为computedWatcher
  computed: boolean
  // 指示是否为同步模式
  sync: boolean
  // 指示值是否已经发生改变，要执行脏值检查
  dirty: boolean
  // 指示当前watcher是否还有效
  active: boolean
  // computedWatcher的Dep实例，做依赖收集
  dep: Dep
  // 非computedWatcher会订阅多个dep来做依赖收集，记录对它们的引用
  deps: Array<Dep>
  newDeps: Array<Dep>
  depIds: SimpleSet
  newDepIds: SimpleSet

  before: ?Function
  getter: Function
  value: any

  constructor(
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean,
  ) {
    this.vm = vm
    // RenderWatcher是组件用于模板渲染的watcher，也就是组件本身的_watcher
    if (isRenderWatcher) {
      vm._watcher = this
    }
    // 将watcher的引用加入vm._watchers
    vm._watchers.push(this)

    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.computed = !!options.computed
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.computed = this.sync = false
    }

    this.cb = cb
    this.id = ++uid
    this.active = true
    // computed类型的watcher，需要首次触发，所以根据computed来设置dirty的初始状态
    this.dirty = this.computed
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''

    // 解析getter的表达式
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      /**
       * 针对string描述的getter，转换为访问传入Object中的对应键
       * 比如：'test1.test2'对应取出target.test1.test2属性的值
       */
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = function () {
        }
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm,
        )
      }
    }

    // computed类型根据dep来取值，普通类型用get()取值即可
    if (this.computed) {
      this.value = undefined
      this.dep = new Dep()
    } else {
      this.value = this.get()
    }
  }

  /**
   * 获得getter的值，并重新收集依赖
   */
  get() {
    // 将前一个watcher入栈，当前watcher设置为正在运行
    pushTarget(this)
    let value
    const vm = this.vm

    try {
      /**
       * getter的this指针和参数都是vm
       * this指针针对用户定制的getter中，this的指向，使得在用户在getter中能操作this
       * 参数vm针对字符串表示的getter中，对它进行键访问
       */
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // deep模式下，触发每个成员的依赖，追踪变化
      if (this.deep) {
        traverse(value)
      }

      // 当前watcher操作完毕，丢弃该watcher，取出前一个watcher
      popTarget()
      // 清理依赖收集
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Deps中添加一个依赖
   * 先暂存入newDeps做查重，没有重复的情况下，将该watcher放入dep.subs订阅者中
   */
  addDep(dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * 清理依赖收集
   */
  cleanupDeps() {
    let i = this.deps.length
    // 针对所有dep，移除dep.subs对该watcher的引用
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    /**
     * 用newDeps替代deps
     */
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * 订阅者的接口。
   * 当依赖发生改变时，会被调用。
   */
  update() {
    // computed的处理
    if (this.computed) {
      /**
       * computed属性的watcher有两种模式：lazy和activated。
       * 默认为lazy模式。
       * 只有在它被至少一个其他的订阅者（通常是另一个computed属性或者组件的render函数）依赖时，才会变成activated模式。
       * 所以可以根据订阅者的数量来判断为哪个模式。
       */
      if (this.dep.subs.length === 0) {
        /**
         * 在lazy模式下，我们只希望在必要的时候才触发计算，因此将watcher标志为dirty，进行指示。
         * 真正的计算会在computed属性被访问时，其getter触发的watcher.evaluate()方法中执行。
         */
        this.dirty = true
      } else {
        /**
         * 在activated模式下，我们要主动地执行计算，但是只在值发生变化的时候通知订阅者
         */
        this.getAndInvoke(() => {
          this.dep.notify()
        })
      }
    }
    // 同步（sync）模式下，直接渲染视图
    else if (this.sync) {
      this.run()
    }
    // 异步模式下，推送到队列中，下一个tick中调用
    else {
      queueWatcher(this)
    }
  }

  /**
   * 调度工作接口。
   * 通常由Scheduler调用
   */
  run() {
    if (this.active) {
      this.getAndInvoke(this.cb)
    }
  }

  getAndInvoke(cb: Function) {
    const value = this.get()
    if (
      value !== this.value ||
      /**
       * 对于deep模式的watcher，或是Object/Array的watcher，
       * value !== this.value只能判断出它的引用没有发生改变，但是成员的值可能已经发生变化了
       */
      isObject(value) ||
      this.deep
    ) {
      // 设置新的值
      const oldValue = this.value
      this.value = value
      this.dirty = false
      /**
       * 给callback绑定this为vm，传参执行
       * 这一段决定了callback的形式为 (value, oldValue) => void(0)，并且可以安全地访问this为当前vm
       */
      if (this.user) {
        try {
          cb.call(this.vm, value, oldValue)
        } catch (e) {
          handleError(e, this.vm, `callback for watcher "${this.expression}"`)
        }
      } else {
        cb.call(this.vm, value, oldValue)
      }
    }
  }

  /**
   * 检查dirty，返回watcher的最新值。
   * 只会被computed属性的watcher调用。
   */
  evaluate() {
    if (this.dirty) {
      this.value = this.get()
      this.dirty = false
    }
    return this.value
  }

  /**
   * dep中添加这个watcher依赖
   * 只会被computed属性的watcher调用。
   */
  depend() {
    if (this.dep && Dep.target) {
      this.dep.depend()
    }
  }

  /**
   * 停用这个watcher，清除这个watcher的所有引用，包括vm._watchers和dep.subs中的
   */
  teardown() {
    if (this.active) {
      /**
       * 这是一个高成本操作。
       * 如果是因为vm要摧毁了，所以要停用这个watcher，那就无需去vm._watchers中做清除
       */
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      // 清除dep.subs中对它的引用
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      // 设置为inactive，停用
      this.active = false
    }
  }
}

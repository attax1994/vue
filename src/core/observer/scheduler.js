/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools
} from '../util/index'

/**
 * Scheduler全局只有一个，所以不建立class
 */

// 一次执行的update次数不能超过100次，帮助停止死循环
export const MAX_UPDATE_COUNT = 100

// 当前队列
const queue: Array<Watcher> = []
// 当前正在使用的组件
const activatedChildren: Array<Component> = []
// 用于存放已有watcher的id，防止重复
let has: { [key: number]: ?true } = {}
// 记录每个watcher在一次执行中，update的次数。超过最大次数，说明存在死循环，要提示用户。
let circular: { [key: number]: number } = {}
let waiting = false
// 指示正在执行队列
let flushing = false
let index = 0

/**
 * 重置Scheduler的状态
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

/**
 * 在Vue.nextTick()中广泛使用，
 * 在下个tick中，执行队列，调用watcher.run()来触发watcher的回调
 */
function flushSchedulerQueue () {
  flushing = true
  let watcher, id

  /**
   * 执行前，对队列进行排序
   * 这将保证：
   * 1. 父组件优先于子组件进行更新（父组件id较小）
   * 2. 组件中，用户自定义的watcher优先于组件render的watcher执行（自定义watcher比render的watcher更早定义，id小）
   * 3. 如果在父组件的watcher更新中，确认要摧毁子组件了，那就可以跳过子组件的watcher（性能优化）
   */
  queue.sort((a, b) => a.id - b.id)

  /**
   * 这里不缓存length，因为在执行现有的watcher.run()中，队列可能会加入新的成员
   */
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) {
      watcher.before()
    }
    id = watcher.id
    has[id] = null
    watcher.run()
    // dev模式下，帮助检查和调停环形更新（死循环）
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // 在重置前，保存之前队列的副本
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()
  resetSchedulerState()

  // 调用组件的activated和updated钩子
  callActivatedHooks(activatedQueue)
  callUpdatedHooks(updatedQueue)

  // devtool的钩子
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

// 调用updated钩子
function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * 在patch期间被激活（activated）的keep-alive组件保存在队列中。
 * patch结束后该队列会被处理
 */
export function queueActivatedComponent (vm: Component) {
  // 将vm._inactive设为false，render函数就可以依赖于watcher检查
  vm._inactive = false
  activatedChildren.push(vm)
}

// 调用activated钩子，并将其子组件activate化
function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}


/**
 * 将一个watcher放入队列。
 * 如果新放入的watcher和现有的有重复（根据id判断），那就跳过，除非是在flush阶段放入的
 * @param watcher
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      /**
       * 如果已经在flush了，根据它的id，找到队列中合适的位置进行插入
       * 如果已经运行到它后面的id了，插在队列首部，下一个立即执行
       */
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // 安排flush
    if (!waiting) {
      waiting = true
      nextTick(flushSchedulerQueue)
    }
  }
}

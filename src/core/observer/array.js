/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import {def} from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
]

/**
 * 拦截Array中会改变Array对象自身的方法，在它们调用时，触发事件
 * 相当于对它做Monkey Patch
 */
methodsToPatch.forEach(function (method) {
  // 暂存原生的方法
  const original = arrayProto[method]
  // 改造原生方法（将其PropertyDescriptor的value覆盖）
  def(arrayMethods, method, function mutator(...args) {
    const result = original.apply(this, args)
    const ob = this.__ob__

    // 处理有新元素插入的情况
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 如果有新的元素插入，将插入的新元素纳入观察
    if (inserted) ob.observeArray(inserted)

    // 通知发生了改变
    ob.dep.notify()
    return result
  })
})

/* @flow */

import { _Set as Set, isObject } from '../util/index'
import type { SimpleSet } from '../util/index'
import VNode from '../vdom/vnode'

const seenObjects = new Set()

/**
 * 在Watcher设置为deep: true的模式下使用。
 * 递归每一个对象或数组，触发他们转换过的getter，
 * 这样每个成员都会被依赖收集，形成深度的依赖关系。
 * 传入一个Set是为了记录已经处理过的depId，避免重复触发某个dep
 */
export function traverse (val: any) {
  _traverse(val, seenObjects)
  seenObjects.clear()
}

function _traverse (val: any, seen: SimpleSet) {
  let i, keys
  const isA = Array.isArray(val)
  if ((!isA && !isObject(val)) || Object.isFrozen(val) || val instanceof VNode) {
    return
  }

  // 记录处理depId，跳过已经处理过的
  if (val.__ob__) {
    const depId = val.__ob__.dep.id
    if (seen.has(depId)) {
      return
    }
    seen.add(depId)
  }

  /**
   * 遍历每个成员，递归处理，从而对成员为引用类型的情况做深度处理。
   * 注意在传参时使用了键访问，此时便会触发getter。
   */
  if (isA) {
    i = val.length
    while (i--) _traverse(val[i], seen)
  } else {
    keys = Object.keys(val)
    i = keys.length
    while (i--) _traverse(val[keys[i]], seen)
  }
}

import { describe, it, expect } from 'vitest'
import { fetchAllPages, fetchByIds } from './supabaseRepository'

const table = Array.from({ length: 2345 }, (_, i) => ({ id: String(i) }))

describe('fetchAllPages', () => {
  it('reads past the old 500-row cap, page by page, with no gaps or repeats', async () => {
    const calls: Array<[number, number]> = []
    const rows = await fetchAllPages<{ id: string }>(async (from, to) => {
      calls.push([from, to])
      return { data: table.slice(from, to + 1), error: null }
    })
    expect(rows).toHaveLength(2345)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2345)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('throws the query error', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })
})

describe('fetchByIds', () => {
  it('splits a large id list into batches', async () => {
    const ids = table.map((r) => r.id)
    const chunkSizes: number[] = []
    const rows = await fetchByIds<{ id: string }>(ids, async (chunk, from, to) => {
      chunkSizes.push(chunk.length)
      return { data: chunk.map((id) => ({ id })).slice(from, to + 1), error: null }
    })
    expect(rows).toHaveLength(2345)
    expect(Math.max(...chunkSizes)).toBe(200)
  })
})

import { vi } from 'vitest'

const { mockGetMetaStore, mockUpsertMeta } = vi.hoisted(() => ({
  mockGetMetaStore: vi.fn(),
  mockUpsertMeta: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/videprinter/storage/meta-store.ts', () => ({
  getMetaStore: mockGetMetaStore,
  upsertMeta: mockUpsertMeta,
}))

const { noteExternalRequest, persistRequestCount } = await import('../../src/videprinter/state/request-counter.ts')

describe('request counter persistence', () => {
  beforeEach(() => {
    mockGetMetaStore.mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) })
    mockUpsertMeta.mockClear()
  })

  test('does not write to the store on every request', async () => {
    // The first call seeds the stored counter; it is the ones after it that used to cost
    // a round-trip each.
    await noteExternalRequest()
    mockUpsertMeta.mockClear()

    await noteExternalRequest()
    await noteExternalRequest()
    await noteExternalRequest()

    expect(mockUpsertMeta).not.toHaveBeenCalled()
  })

  test('writes the running total once when flushed', async () => {
    await noteExternalRequest()
    await noteExternalRequest()
    await persistRequestCount()

    expect(mockUpsertMeta).toHaveBeenCalledTimes(1)
    expect(mockUpsertMeta.mock.calls[0]?.[1]).toMatchObject({ count: expect.any(Number) })
  })

  test('does not write again when nothing has changed since the last flush', async () => {
    await noteExternalRequest()
    await persistRequestCount()
    mockUpsertMeta.mockClear()

    await persistRequestCount()

    expect(mockUpsertMeta).not.toHaveBeenCalled()
  })
})

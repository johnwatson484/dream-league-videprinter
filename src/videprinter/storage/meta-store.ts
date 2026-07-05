import type { Collection, Db } from 'mongodb'

let metaCollection: Collection | undefined

export function registerMetaCollection (db: Db): void {
  metaCollection = db.collection('meta')
  metaCollection.createIndex({ _id: 1 }, { unique: true }).catch(() => {})
}

export function getMetaStore (): Collection | undefined { return metaCollection }

export async function upsertMeta (id: string, value: Record<string, unknown>): Promise<void> {
  if (!metaCollection) { return }
  await metaCollection.updateOne({ _id: id } as any, { $set: { ...value } }, { upsert: true })
}

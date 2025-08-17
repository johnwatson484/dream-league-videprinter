// Meta store relies on mongo.js having initialized and provided DB reference.

let metaCollection

export function registerMetaCollection (db) {
  metaCollection = db.collection('meta')
  metaCollection.createIndex({ _id: 1 }, { unique: true }).catch(() => {})
}

export function getMetaStore () { return metaCollection }

export async function upsertMeta (id, value) {
  if (!metaCollection) return
  await metaCollection.updateOne({ _id: id }, { $set: { ...value } }, { upsert: true })
}

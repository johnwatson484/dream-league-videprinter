import neostandard from 'neostandard'

export default [
  ...neostandard({
    ts: true,
    globals: ['describe', 'beforeEach', 'expect', 'test', 'afterEach', 'vi', 'beforeAll', 'afterAll']
  }),
  {
    rules: {
      curly: ['error', 'all']
    }
  }
]

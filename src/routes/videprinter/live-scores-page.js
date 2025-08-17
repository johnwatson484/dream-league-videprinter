const route = {
  method: 'GET',
  path: '/live-scores',
  handler: (request, h) => {
    return h.view('live-scores')
  },
}

export default route

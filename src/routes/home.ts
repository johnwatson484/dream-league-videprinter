const route = {
  method: 'GET',
  path: '/',
  handler: (request, h) => {
    return h.redirect('/live-scores')
  },
}

export default route

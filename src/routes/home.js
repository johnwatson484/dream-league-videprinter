const route = {
  method: 'GET',
  path: '/',
  handler: (request, h) => {
    return h.view('home')
  },
}

export default route

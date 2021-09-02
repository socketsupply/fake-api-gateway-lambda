//setInterval(require('why-is-node-running'), 1000).unref()
var DockerLambda = require('../docker')
var path = require('path')
var d = new DockerLambda('/hello', path.join(__dirname, 'hello.js'), {}, 'handler')
d.ready.then(()=>{
  console.log('done******************')
  d.request('1', {}).then(v => console.log(v))
}).catch(e => console.log(e))

return
setTimeout(function () {
  console.log("CLOSE")
  d.close()

}, 10000)
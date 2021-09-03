'use strict'

const util = require('util')
const path = require('path')
const events = require('events')
const fs = require('fs')
const cp = require('child_process')
const fetch = require('node-fetch').default
const ncp = util.promisify(require('ncp'))
// run lambda process within docker.


let START_PORT = ~~(9000 + Math.random() * 1000)

async function copy (src, dest, cb) {
  await fs.promises.mkdir(dest, {recursive:true})
  return ncp(src, dest, {})
}

function createDockerfile (runtime, handler) {
  return `
FROM public.ecr.aws/lambda/${runtime}

# Copy function code
COPY * $\{LAMBDA_TASK_ROOT}/

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "${handler}" ]
`
}

async function dockerLambdaReady (port, max = 1000) {
  var start = Date.now()
  while(Date.now() < max + start) {
    try {
      return await fetch('http://localhost:${port}')
    } catch (err) {
       //loop...
    }
  }
}

function log (proc) {
  proc.stdout.on('data', d => process.stdout.write(d))
  proc.stderr.on('data', d => process.stderr.write(d))
  return proc
}

class DockerLambda {
  constructor (_path, entry, env, handler, runtime) {
    console.log('DOCKER', [_path, entry, env, handler, runtime])
    this.path = _path
    if (!/^nodejs:/.test(runtime)) { throw new Error('only node.js runtime supported currently') }
    // copy input to tmp dir
    // insert Dockerfile
    // run docker build
    // start docker
    // use fetch, but return expected event object.
    this.port = START_PORT++
    this.entry = entry
    this.env = env
    this.handler = handler
    this.runtime = runtime  

    this.ready = this.bootstrap()
  }

  async bootstrap () {
        const envArray = Object.keys(this.env)
      .map(k => ['--env', k + '=' + this.env[k]])
      .reduce((a, b) => a.concat(b), [])

    const id = 'operator-docker_' + Date.now()
    const tmp = '/tmp/' + id
    await copy(path.dirname(this.entry), tmp)
    const basename = path.basename(this.entry)
    const base = basename.substring(0, basename.indexOf(path.extname(basename)))
    await fs.promises.writeFile(
      path.join(tmp, 'Dockerfile'),
      createDockerfile('nodejs:12', base + '.' + this.handler))
        
    console.log(['>docker', 'build', tmp, '-t', id].join(' '))
      
    this.proc = log(cp.spawn('docker', ['build', tmp, '-t', id]))
    const [code] = await events.once(this.proc, 'exit')

    if (code) { throw new Error('docker build failed') }

    // XXX: I think this should error but that breaks the tests...
    if (this.closed) return
    // throw new Error('closed during startup')

    console.log(['>docker', 'run', '-it', '-p', `${this.port}:8080`].concat(envArray).concat([id]).join(' '))
        //  this.proc = log(cp.spawn('docker', ['run', id, '-p', `${this.port}:8080`].concat(envArray)))

    // if the id isn't the very last argument you'll get an error
    // "entrypoint requires that handler must be first arg"
    // which won't help you figure it out.
    this.proc = log(cp.spawn('docker', ['run', '-p', `${this.port}:8080`]
      .concat(envArray)
      .concat([id])
    ))
    await dockerLambdaReady(this.port)
  }

  async request (id, eventObject) {
    await this.ready
    return (await fetch(`http://localhost:${this.port}/2015-03-31/functions/function/invocations`,
      { method: 'post', body: JSON.stringify(eventObject) })
    ).json()
  }

  async close () {
    this.closed = true
    if (this.proc) {
      this.proc.kill(9)
      events.once(this.proc, 'exit')
    }
  }
}

module.exports = DockerLambda

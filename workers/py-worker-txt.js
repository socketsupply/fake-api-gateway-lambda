module.exports = `
import sys, json, importlib.util

entry = sys.argv[1]
handler = sys.argv[2]

event = ''
for line in sys.stdin:
  event = json.loads(line)
  break

id = event['id']
eventObject = event['eventObject']

spec = importlib.util.spec_from_file_location(
  "module.name", entry
)
index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index)

handlerFn = getattr(index, handler)

result = handlerFn(eventObject, {})

resultObj = {
  'message': 'result',
  'id': id,
  'result': {
    'isBase64Encoded': result.get('isBase64Encoded') or False,
    'statusCode': result.get('statusCode'),
    'headers': result.get('headers') or {},
    'body': result.get('body') or '',
    'multiValueHeaders': result.get('multiValueHeaders')
  }
}

line = '\\n__FAKE_LAMBDA_START__ ' + json.dumps(resultObj) + '__FAKE_LAMBDA_END__'

print(line, flush=True)
`

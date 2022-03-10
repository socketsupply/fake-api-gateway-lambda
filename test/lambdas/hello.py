import json

def lambda_handler(event, context):
    print('python hello')

    print('event', event)

    # TODO implement
    return {
        'statusCode': 200,
        'body': json.dumps('Hello from Lambda! (python)')
    }

import sys
import json
from gpt4all import GPT4All

def generate_roast(target_username, target_message):
    prompt = f"Generate a harsh roast directed at '{target_username}' who said: '{target_message}'. Provide a short response roasting '{target_username}'."

    try:
        gpt = GPT4All(model_name='mistral-7b-instruct-v0.1.Q4_0.gguf', model_path='.\\models')  # make changes to the path here!!!
        roast = gpt.generate(prompt, max_tokens=100)
        return roast
    except Exception as e:
        print(f"Error generating roast: {e}", file=sys.stderr)
        return ''


if __name__ == '__main__':
    try:
        input_data = sys.stdin.read()
        print(f"Input data: {input_data}", file=sys.stderr)  # Debugging line
        data = json.loads(input_data)
        target_username = data.get('targetUsername', '')
        target_message = data.get('targetMessage', '')
        roast = generate_roast(target_username, target_message)
        print(roast)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
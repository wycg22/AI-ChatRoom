import sys
import json
from gpt4all import GPT4All

def generate_fact_check(target_username, target_message):
    prompt = f"Fact-check the following statement: '{target_message}'. Provide a short response on whether the statement is true or not."

    try:
        gpt = GPT4All(model_name='mistral-7b-instruct-v0.1.Q4_0.gguf', model_path='.\\models') # make changes to the model path here!!!
        fact_check_response = gpt.generate(prompt, max_tokens=100)
        return fact_check_response
    except Exception as e:
        print(f"Error generating fact-check: {e}", file=sys.stderr)
        return ''

if __name__ == '__main__':
    try:
        input_data = sys.stdin.read()
        data = json.loads(input_data)
        target_username = data.get('targetUsername', '')
        target_message = data.get('targetMessage', '')
        fact_check = generate_fact_check(target_username, target_message)
        print(fact_check)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
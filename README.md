For my AI feature implementation, I installed an LLM model locally and used gpt4all api to fetch responses from it.
Since the file is too large, I was not able to push it onto github, so here are the steps to making the feature work:

1. Go into the models folder and open download.txt. The google drive link to install the model should be there.
2. Alternatively, install Mistral Instruct from gpt4all the file name should be: mistral-7b-instruct-v0.1.Q4_0.gguf
3. Install the GPT4all python package (run "pip install gpt4all" in terminal)
4. Once the model is installed, move the file into the 'models' folder (where you found download.txt).
5. If the file is not in the models directory, you can change line 9 in factcheck.py AND roast.py to match the directory that the file is located in.
6. run node server.js to launch
7. username and password combinations were not modified so you can use (alice, secret) or (bob, password)
8. Enter a chatroom and scroll up to find past messages to roast or fact check, or you can send your own messages to roast or fact-check.
9. Do note that you can only roast or fact check messages from other users.

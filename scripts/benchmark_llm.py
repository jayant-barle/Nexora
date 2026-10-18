import http.client
import json
import time

conn = http.client.HTTPConnection("127.0.0.1", 11434, timeout=90)
payload = {
    "model": "qwen3-vl:8b",
    "messages": [
        {"role": "user", "content": "Return a JSON object: {\"status\": \"ok\", \"model_name\": \"qwen3-vl:8b\"}"}
    ],
    "format": "json",
    "stream": False
}

start = time.time()
conn.request("POST", "/api/chat", json.dumps(payload), {"Content-Type": "application/json"})
res = conn.getresponse()
duration = time.time() - start
data = json.loads(res.read().decode("utf-8"))

print(f"Status Code: {res.status}")
print(f"Duration (seconds): {duration:.2f}")
print(f"Response: {data.get('message', {}).get('content')}")
print(f"Eval count: {data.get('eval_count')}")
print(f"Prompt eval count: {data.get('prompt_eval_count')}")

import os
import json
import sqlite3
from datetime import datetime
from flask import Flask, request, Response, jsonify, session, redirect, send_from_directory, g
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from dotenv import load_dotenv

from difflib import SequenceMatcher
from groq import Groq
from serpapi.google_search import GoogleSearch

load_dotenv()

app = Flask(__name__, static_url_path='', static_folder='static')
app.secret_key = os.getenv("FLASK_SECRET_KEY", "supersecret")

bcrypt = Bcrypt(app)
CORS(app, supports_credentials=True)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "chat.db")

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def recreate_db():
    print(f"Recreating database at {DB_PATH}")
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute("DROP TABLE IF EXISTS messages")
        c.execute("DROP TABLE IF EXISTS chats")
        c.execute("DROP TABLE IF EXISTS users")
        c.execute("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                phone TEXT,
                password_hash TEXT
            )
        """)
        c.execute("""
            CREATE TABLE chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT,
                created_at TEXT
            )
        """)
        c.execute("""
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER,
                user_id INTEGER,
                role TEXT,
                content TEXT,
                timestamp TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(chat_id) REFERENCES chats(id)
            )
        """)
        conn.commit()
    print("Database recreated successfully.")

# For development/testing, recreate DB on start
with app.app_context():
    recreate_db()

def get_user(identifier):
    cur = get_db().execute(
        "SELECT id, username, password_hash FROM users WHERE username=? OR email=? OR phone=?",
        (identifier, identifier, identifier)
    )
    return cur.fetchone()

def save_message(chat_id, user_id, role, content):
    get_db().execute(
        "INSERT INTO messages (chat_id, user_id, role, content, timestamp) VALUES (?,?,?,?,?)",
        (chat_id, user_id, role, content, datetime.utcnow().isoformat())
    )
    get_db().commit()

def should_search(query):
    keywords = ["latest", "news", "who is", "what is", "when is", "current", "today", "weather", "score", "update"]
    return any(kw in query.lower() for kw in keywords)

def perform_search(query):
    try:
        params = {
            "engine": "google",
            "q": query,
            "api_key": os.getenv("SERPAPI_API_KEY"),
            "hl": "en",
            "gl": "us",
            "num": 3
        }
        search = GoogleSearch(params)
        results = search.get_dict()
        organic_results = results.get("organic_results", [])
        snippets = [item.get("snippet") or item.get("title") or "" for item in organic_results]
        return "\n".join(snippets)
    except Exception as e:
        return f"[Search error: {e}]"

@app.route("/")
def index():
    if "user_id" not in session:
        return redirect("login.html")
    return send_from_directory("static", "index.html")

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    username = data.get("username", "").strip()
    email = data.get("email", "").strip()
    phone = data.get("phone", "").strip()
    pwd = data.get("password", "").strip()

    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if not email:
        return jsonify({"error": "Email is required"}), 400
    if not pwd or len(pwd) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        return jsonify({"error": "Username is already taken"}), 400
    if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({"error": "Email is already registered"}), 400
    if phone and db.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone():
        return jsonify({"error": "Phone number already in use"}), 400

    h = bcrypt.generate_password_hash(pwd).decode("utf-8")
    db.execute("INSERT INTO users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)", (username, email, phone, h))
    db.commit()
    return jsonify({"success": True})

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    identifier, pwd = data.get("identifier", "").strip(), data.get("password", "").strip()
    user = get_user(identifier)
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
    uid, uname, h = user
    if not bcrypt.check_password_hash(h, pwd):
        return jsonify({"error": "Invalid credentials"}), 401
    session["user_id"], session["username"] = uid, uname
    return jsonify({"success": True})

@app.route("/logout")
def logout():
    session.clear()
    return redirect("login.html")

@app.route("/chats")
def list_chats():
    if "user_id" not in session:
        return jsonify([])
    cur = get_db().execute("SELECT id, title, created_at FROM chats WHERE user_id=? ORDER BY id DESC", (session["user_id"],))
    return jsonify([{"id": cid, "title": title, "created_at": created} for cid, title, created in cur.fetchall()])

@app.route("/new_chat", methods=["POST"])
def new_chat():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401
    cur = get_db().execute("INSERT INTO chats (user_id, title, created_at) VALUES (?, ?, ?)", (session["user_id"], "New Chat", datetime.utcnow().isoformat()))
    chat_id = cur.lastrowid
    get_db().commit()
    return jsonify({"success": True, "chat_id": chat_id})

@app.route("/delete_chat/<int:chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401
    uid = session["user_id"]
    get_db().execute("DELETE FROM messages WHERE chat_id=? AND user_id=?", (chat_id, uid))
    get_db().execute("DELETE FROM chats WHERE id=? AND user_id=?", (chat_id, uid))
    get_db().commit()
    return jsonify({"success": True})

@app.route("/history/<int:chat_id>")
def history(chat_id):
    if "user_id" not in session:
        return jsonify([])
    cur = get_db().execute("SELECT role, content, timestamp FROM messages WHERE chat_id=? AND user_id=? ORDER BY id ASC", (chat_id, session["user_id"]))
    return jsonify([{"role": r, "content": c, "timestamp": t} for r, c, t in cur.fetchall()])

@app.route("/chat", methods=["POST"])
def chat():
    if "user_id" not in session:
        return Response('data: {"token":"[Error: Not logged in]","done":true}\n\n', mimetype="text/event-stream")
    user_msg = request.json.get("message", "").strip()
    chat_id = request.json.get("chat_id")
    if not chat_id:
        return Response('data: {"token":"[Error: missing chat_id]","done":true}\n\n', mimetype="text/event-stream")
    if not user_msg:
        return Response('data: {"token":"[Error: empty message]","done":true}\n\n', mimetype="text/event-stream")

    user_id = session["user_id"]
    prev_msgs_raw = get_db().execute("SELECT role, content FROM messages WHERE chat_id=? AND user_id=? ORDER BY id ASC", (chat_id, user_id)).fetchall()

    system_message = {"role": "system", "content": "You are an assistant named Avyra AI. Use relevant info and web search results."}
    messages = [system_message] + [{"role": role, "content": content} for role, content in prev_msgs_raw]

    if should_search(user_msg):
        search_result = perform_search(user_msg)
        if search_result and not search_result.startswith("[Search error:"):
            messages.append({"role": "assistant", "content": f"Here is some up-to-date information I found on the web:\n{search_result}"})
        else:
            messages.append({"role": "assistant", "content": f"The web search failed: {search_result}"})

    messages.append({"role": "user", "content": user_msg})
    save_message(chat_id, user_id, "user", user_msg)

    def generate():
        full_reply = ""
        try:
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                stream=True
            )
            for chunk in completion:
                delta = getattr(chunk.choices[0].delta, "content", None)
                if delta:
                    full_reply += delta
                    yield f"data: {json.dumps({'token': delta})}\n\n"
            with app.app_context():
                save_message(chat_id, user_id, "assistant", full_reply)
            yield 'data: {"done": true}\n\n'
        except Exception as e:
            yield f"data: {json.dumps({'token': f'[Error: {e}]', 'done': True})}\n\n"

    return Response(generate(), mimetype="text/event-stream")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))  # Render default port 10000
    print(f"Serving app at 0.0.0.0:{port} using DB {DB_PATH}")
    app.run(host="0.0.0.0", port=port, threaded=True)
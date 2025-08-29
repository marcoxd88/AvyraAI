marked.setOptions({
  highlight: (code, lang) => lang && hljs.getLanguage(lang)
    ? hljs.highlight(code, { language: lang }).value
    : hljs.highlightAuto(code).value
});

let currentChatId = null;

const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const typingIndicator = document.getElementById("typing-indicator");
const chatList = document.getElementById("chat-list");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarOverlay = document.querySelector(".sidebar-overlay");

const sendButton = chatForm.querySelector("button[type='submit']");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const themeIcon = document.getElementById("theme-icon");

const stopButton = document.createElement("button");
stopButton.type = "button";
stopButton.textContent = "■";
stopButton.title = "Stop generating";
stopButton.style.display = "none";
stopButton.style.marginLeft = "10px";
stopButton.style.backgroundColor = "#ff4c4c";
stopButton.style.color = "white";
stopButton.style.border = "none";
stopButton.style.borderRadius = "50%";
stopButton.style.width = "40px";
stopButton.style.height = "40px";
stopButton.style.cursor = "pointer";
chatForm.appendChild(stopButton);

let abortController = null;
let scrollTimeout;

// Sidebar toggle functionality
function toggleSidebar() {
    sidebar.classList.toggle("sidebar-expanded");
    sidebarOverlay.classList.toggle("sidebar-expanded");
    const isExpanded = sidebar.classList.contains("sidebar-expanded");
    sidebarToggle.setAttribute("aria-expanded", isExpanded);
    sidebarToggle.setAttribute("aria-label", isExpanded ? "Close sidebar" : "Open sidebar");
}

sidebarToggle.addEventListener("click", toggleSidebar);
sidebarOverlay.addEventListener("click", toggleSidebar);

// Close sidebar on outside click (for mobile)
document.addEventListener("click", (e) => {
    if (window.innerWidth <= 768 && 
        sidebar.classList.contains("sidebar-expanded") &&
        !sidebar.contains(e.target) && 
        e.target !== sidebarToggle) {
        toggleSidebar();
    }
});

// Close sidebar on Escape key
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("sidebar-expanded")) {
        toggleSidebar();
    }
});

// Responsive sidebar behavior on resize
window.addEventListener("resize", () => {
    if (window.innerWidth > 768 && sidebar.classList.contains("sidebar-expanded")) {
        toggleSidebar();
    }
});

// Initial sidebar state based on screen width
if (window.innerWidth <= 768) {
    sidebar.classList.remove("sidebar-expanded");
    sidebarOverlay.classList.remove("sidebar-expanded");
} else {
    sidebar.classList.add("sidebar-expanded");
}

// Theme toggle logic with custom images
function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-theme");
    themeIcon.src = "https://ik.imagekit.io/ryh8eunbca/light.png?updatedAt=1756300131960";
    themeIcon.alt = "Light mode";
  } else {
    document.body.classList.remove("light-theme");
    themeIcon.src = "https://ik.imagekit.io/ryh8eunbca/night.png?updatedAt=1756300140081";
    themeIcon.alt = "Dark mode";
  }
}

let savedTheme = localStorage.getItem("theme");
if (!savedTheme) {
  savedTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
applyTheme(savedTheme);

themeToggleBtn.addEventListener("click", () => {
  savedTheme = document.body.classList.contains("light-theme") ? "dark" : "light";
  localStorage.setItem("theme", savedTheme);
  applyTheme(savedTheme);
});

// Rest of chat app code follows...

async function loadChats() {
  const res = await fetch("/chats");
  if (!res.ok) return;
  const chats = await res.json();
  chatList.innerHTML = "";
  chats.forEach(c => {
    const container = document.createElement("div");
    container.classList.add("chat-item-container");
    if (c.id === currentChatId) container.classList.add("active");

    const chatDiv = document.createElement("div");
    chatDiv.textContent = c.title || "Untitled Chat";
    chatDiv.classList.add("chat-item");
    chatDiv.onclick = () => {
      currentChatId = c.id;
      loadHistory();
      loadChats();
      if (window.innerWidth <= 768) {
        toggleSidebar();
      }
    };

    const delBtn = document.createElement("button");
    delBtn.title = "Delete chat";
    delBtn.classList.add("delete-chat-btn");

    const img = document.createElement("img");
    img.src = "https://ik.imagekit.io/ryh8eunbca/delete.png?updatedAt=1756295737425";
    img.alt = "Delete";
    img.style.width = "20px";
    img.style.height = "20px";
    img.style.pointerEvents = "none";

    delBtn.appendChild(img);

    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm("Are you sure you want to delete this chat?")) {
        const delRes = await fetch(`/delete_chat/${c.id}`, { method: "DELETE" });
        if (delRes.ok) {
          if (currentChatId === c.id) {
            currentChatId = null;
            chatBox.innerHTML = "";
          }
          loadChats();
        } else {
          alert("Failed to delete chat");
        }
      }
    };

    container.appendChild(chatDiv);
    container.appendChild(delBtn);
    chatList.appendChild(container);
  });
}

async function newChat() {
  const res = await fetch("/new_chat", { method: "POST" });
  if (!res.ok) return;
  const data = await res.json();
  if (data.success) {
    currentChatId = data.chat_id;
    chatBox.innerHTML = "";
    loadChats();
    if (window.innerWidth <= 768) {
      toggleSidebar();
    }
  }
}

async function loadHistory() {
  if (!currentChatId) return;
  const res = await fetch(`/history/${currentChatId}`);
  if (!res.ok) return;
  const data = await res.json();
  chatBox.innerHTML = "";
  data.forEach(m => appendMessage(m.content, m.role, new Date(m.timestamp)));
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: "smooth" });
}

function doSmoothScroll() {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: "smooth" });
  }, 40);
}

function toggleButtons(isRunning) {
  if (isRunning) {
    sendButton.style.display = "none";
    stopButton.style.display = "inline-block";
  } else {
    sendButton.style.display = "inline-block";
    stopButton.style.display = "none";
  }
}

chatForm.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

stopButton.addEventListener("click", () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  typingIndicator.classList.add("hidden");
  toggleButtons(false);
});

chatForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || !currentChatId) {
    typingIndicator.classList.add("hidden");
    toggleButtons(false);
    return;
  }

  appendMessage(text, "user", new Date());
  userInput.value = "";

  toggleButtons(true);

  const botElem = appendMessage("", "bot", new Date(), true);

  abortController = new AbortController();

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: currentChatId, message: text }),
      signal: abortController.signal,
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let botText = "";
    let typingStarted = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (let line of chunk.split("\n")) {
        if (line.startsWith("data:")) {
          const dataText = line.slice(5);
          if (!dataText) continue;
          try {
            const data = JSON.parse(dataText);
            if (data.token) {
              if (!typingStarted) {
                typingIndicator.classList.remove("hidden");
                typingStarted = true;
              }
              botText += data.token;
              botElem.innerHTML = marked.parse(botText);

              botElem.querySelectorAll("pre").forEach(pre => {
                if (!pre.querySelector(".copy-code-btn")) {
                  const btn = document.createElement("button");
                  btn.textContent = "Copy Code";
                  btn.className = "copy-code-btn";
                  btn.style.position = "absolute";
                  btn.style.top = "8px";
                  btn.style.right = "8px";
                  btn.style.zIndex = "10";

                  btn.onclick = () => {
                    const codeText = pre.querySelector("code")?.innerText || "";
                    navigator.clipboard.writeText(codeText).then(() => {
                      btn.textContent = "Copied!";
                      setTimeout(() => btn.textContent = "Copy Code", 1500);
                    }).catch(() => alert("Failed to copy code"));
                  };

                  pre.style.position = "relative";
                  pre.appendChild(btn);
                }
              });

              doSmoothScroll();
            }
            if (data.done) {
              typingIndicator.classList.add("hidden");
              toggleButtons(false);
              botElem.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));
              loadChats();
              abortController = null;
            }
          } catch (err) {
            // ignore JSON parse errors
          }
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError")
      appendMessage("[Response stopped by user]", "bot", new Date());
    else appendMessage("[Error occurred]", "bot", new Date());
    typingIndicator.classList.add("hidden");
    toggleButtons(false);
    abortController = null;
  }
});

function appendMessage(text, sender, time, isHTML = false) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);

  if (isHTML || sender === "bot") {
    msg.innerHTML = marked.parse(text || "");
  } else {
    msg.textContent = text;
  }

  const ts = document.createElement("div");
  ts.classList.add("time");
  ts.textContent = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  msg.appendChild(ts);

  chatBox.appendChild(msg);
  return msg;
}

document.getElementById("new-chat-btn").onclick = newChat;

(async function () {
  await loadChats();
  if (!currentChatId) await newChat();
  await loadHistory();
})();

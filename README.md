# RemAdder 🚀

**RemAdder** is a powerful dual-component tool that bridges the gap between web browsing and your RemNote knowledge base. It allows you to instantly extract content from any webpage, use a Large Language Model (LLM) to summarize and generate high-quality flashcards, and push them directly into your RemNote workspace.

## 🌟 Features

- **Intelligent Web Extraction:** Automatically identifies and extracts the main content of any article or webpage, ignoring boilerplate (ads, navbars, footers).
- **AI-Powered Flashcards:** Generates structured flashcards (Basic and Cloze) from the content.
- **Universal LLM Support:** Bring your own API key! Supports:
  - 🟢 OpenAI (GPT-4o)
  - 🔵 Google Gemini
  - 🟠 Anthropic Claude
  - ⚙️ Custom OpenAI-Compatible Endpoints (NVIDIA NIM, Groq, LM Studio, Ollama, etc.)
- **Zero-Touch Organization:** Automatically creates hierarchical folder structures inside RemNote based on the content context.

## 🏗️ Architecture

RemAdder consists of two connected parts that talk to each other to bypass browser limitations:

1. **Browser Extension (Manifest V3):** The control center. It lives in your browser toolbar, reads the webpage, communicates with your chosen LLM, and sends the generated flashcards to the companion plugin.
2. **RemNote Companion Plugin (React):** The bridge. It runs inside RemNote, receives the flashcard data from the extension, and uses the official RemNote API (`plugin.rem.createWithMarkdown`) to inject the cards into your database.

---

## 🚀 Getting Started

### 1. Install the Browser Extension
1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `browser-extension` folder from this repository.

### 2. Install the RemNote Companion Plugin
1. Open your terminal and navigate to the plugin folder:
   ```bash
   cd remnote-plugin
   ```
2. Install dependencies and start the development server:
   ```bash
   npm install
   npm run dev
   ```
3. Open [RemNote](https://www.remnote.com) in your browser.
4. Go to **Settings > Plugins > Build**.
5. Click **Develop from Localhost** (ensure it's pointing to `http://localhost:8080`).

### 3. Configure Your LLM
1. Click the **RemAdder (RA) icon** in your browser toolbar to open the extension.
2. Click the **Settings (⚙️) icon**.
3. Choose your preferred LLM provider, enter your API key, and configure the model.
4. If using a custom endpoint (like NVIDIA NIM), ensure you provide the full URL (e.g., `https://integrate.api.nvidia.com/v1`).
5. Click **Save Settings**.

## 📖 How to Use
1. Navigate to any article or documentation you want to learn.
2. Open the RemAdder extension.
3. Click **"Summarize & Add to RemNote"**.
4. The extension will read the page, generate flashcards using your AI, and push them directly into RemNote under a new Document!

## 📄 License
This project is licensed under the [MIT License](LICENSE).

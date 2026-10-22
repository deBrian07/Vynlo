import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(
  <main>
    <h1>Vynlo</h1>
    <p>Email, without the friction.</p>
    <button onClick={() => void chrome.tabs.create({ url: 'https://mail.google.com/' })}>
      Open Gmail
    </button>
    <button onClick={() => void chrome.runtime.openOptionsPage()}>Settings</button>
  </main>,
);

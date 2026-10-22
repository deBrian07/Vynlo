import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo } from '../../src/components/ui';
import { DEFAULT_SETTINGS, type Settings } from '../../src/types/model';
import '../../src/styles/app.css';

function isTheme(value: unknown): value is Settings['theme'] {
  return value === 'system' || value === 'light' || value === 'dark';
}

function Popup() {
  const [theme, setTheme] = useState<Settings['theme']>(DEFAULT_SETTINGS.theme);
  const [dark, setDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const load = () => {
      void chrome.storage.local.get('settings').then((data) => {
        const stored = data.settings;
        if (stored && typeof stored === 'object' && 'theme' in stored && isTheme(stored.theme))
          setTheme(stored.theme);
      });
    };
    load();
    chrome.storage.onChanged.addListener(load);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setDark(media.matches);
    media.addEventListener('change', change);
    return () => {
      chrome.storage.onChanged.removeListener(load);
      media.removeEventListener('change', change);
    };
  }, []);
  const resolved = theme === 'system' ? (dark ? 'dark' : 'light') : theme;
  return (
    <main className={`vynlo theme-${resolved} popup`}>
      <Logo />
      <p className="muted">
        Email, without the friction. Your notes and reminders stay in this browser.
      </p>
      <div className="popup-actions">
        <button
          className="primary"
          onClick={() => void chrome.tabs.create({ url: 'https://mail.google.com/mail/' })}
        >
          Open Gmail
        </button>
        <button onClick={() => void chrome.runtime.openOptionsPage()}>Settings</button>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);

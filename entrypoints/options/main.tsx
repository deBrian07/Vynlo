import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import Workspace from '../../src/components/Workspace';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { DEFAULT_SETTINGS, type Settings } from '../../src/types/model';
import '../../src/styles/app.css';

function OptionsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [dark, setDark] = useState(matchMedia('(prefers-color-scheme:dark)').matches);
  useEffect(() => {
    const load = () => {
      void chrome.storage.local.get('settings').then((d) => {
        if (d.settings) setSettings(d.settings as Settings);
      });
    };
    load();
    chrome.storage.onChanged.addListener(load);
    const media = matchMedia('(prefers-color-scheme:dark)');
    const change = () => setDark(media.matches);
    media.addEventListener('change', change);
    return () => {
      chrome.storage.onChanged.removeListener(load);
      media.removeEventListener('change', change);
    };
  }, []);
  return (
    <div
      className={`vynlo options-page theme-${settings.theme === 'system' ? (dark ? 'dark' : 'light') : settings.theme}`}
    >
      <ErrorBoundary>
        <Workspace options initialView="settings" />
      </ErrorBoundary>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<OptionsApp />);

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (import.meta.env.VITE_DEMO_MODE) {
  void import('./demo/DemoApp').then(({ DemoApp }) => root.render(<React.StrictMode><DemoApp repositoryUrl={import.meta.env.VITE_REPOSITORY_URL} /></React.StrictMode>));
} else {
  void Promise.all([import('./App'), import('./components/Authentication')]).then(([{ App }, { Authentication }]) => {
    root.render(<React.StrictMode><Authentication><App /></Authentication></React.StrictMode>);
  });
}

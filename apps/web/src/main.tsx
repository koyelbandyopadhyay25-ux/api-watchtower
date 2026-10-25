import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { Authentication } from './components/Authentication';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Authentication><App /></Authentication></React.StrictMode>,
);

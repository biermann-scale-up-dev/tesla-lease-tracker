import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { Experience } from './Experience.js';
import { TeslaView } from './TeslaView.js';
import './styles.css';
import './mobile.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Experience>{location.pathname === '/tesla' ? <TeslaView/> : <App />}</Experience></React.StrictMode>);

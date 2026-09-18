import React from 'react';

export const sysAlert = (message: React.ReactNode | string) => {
    window.dispatchEvent(new CustomEvent('sys-dialog', { detail: { type: 'alert', message } }));
};

export const sysConfirm = (message: React.ReactNode | string, onConfirm: () => void) => {
    window.dispatchEvent(new CustomEvent('sys-dialog', { detail: { type: 'confirm', message, onConfirm } }));
};

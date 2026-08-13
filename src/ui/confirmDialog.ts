export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/** 自定义确认对话框（替代 window.confirm），返回 Promise<boolean> */
export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-overlay';
    root.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h3 class="modal-title" id="confirm-dialog-title">${escapeHtml(options.title)}</h3>
        <p class="modal-message">${escapeHtml(options.message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn modal-cancel">${escapeHtml(options.cancelText ?? '取消')}</button>
          <button type="button" class="btn btn-primary ${options.danger ? 'btn-danger' : ''} modal-confirm">
            ${escapeHtml(options.confirmText ?? '确认')}
          </button>
        </div>
      </div>
    `;

    let done = false;
    const finish = (result: boolean): void => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter') finish(true);
    };

    root.querySelector('.modal-cancel')!.addEventListener('click', () => finish(false));
    root.querySelector('.modal-confirm')!.addEventListener('click', () => finish(true));
    root.addEventListener('click', (e) => {
      if (e.target === root) finish(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    (root.querySelector('.modal-confirm') as HTMLButtonElement).focus();
  });
}

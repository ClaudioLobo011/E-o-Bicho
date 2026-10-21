(() => {
  const button = document.getElementById('download-aspia');
  const status = document.getElementById('download-aspia-status');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = 'Preparando download do Aspia…';
    try {
      const token = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token;
      if (!token) throw new Error('Entre novamente no painel para baixar o Aspia.');
      const response = await fetch(`${API_CONFIG.BASE_URL}/admin/downloads/aspia`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Não foi possível baixar o Aspia. Tente novamente.');
      }
      if (!response.headers.get('content-type')?.includes('application/zip')) {
        throw new Error('O servidor não retornou o instalador. Tente novamente mais tarde.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Aspia-EoBicho-Host-Setup-2026.10.21.5.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = 'Download iniciado. Extraia o ZIP, execute INSTALAR-ASPIA-EOBICHO.cmd e aceite a solicitação de administrador.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
})();

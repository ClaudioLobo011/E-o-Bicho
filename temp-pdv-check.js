async function test() {
  await fetchWithOptionalAuth(
    `${API_BASE}/exchanges/${encodeURIComponent(state.exchangeModal.exchangeId)}`,
    {
      method: 'DELETE',
      token,
      errorMessage: 'Nao foi possivel excluir a troca.',
    }
  );
}

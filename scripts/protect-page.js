(function protectPage() {
    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
    if (!loggedInUser || !loggedInUser.id) {
        console.warn("Acesso negado: Utilizador não logado. A redirecionar para o login.");
        window.location.replace('login.html');
    }
})();
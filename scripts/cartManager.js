const CartManager = {
    getToken: function() {
        const user = JSON.parse(localStorage.getItem('loggedInUser'));
        return user ? user.token : null;
    },

    getUserId: function() {
        const user = JSON.parse(localStorage.getItem('loggedInUser'));
        return user ? user.id : null;
    },

    getCart: async function() {
        const userId = this.getUserId();
        const token = this.getToken();
        if (!userId || !token) return [];

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/cart/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.error("Erro na resposta do servidor:", response.status);
                return [];
            }

            const data = await response.json();
            if (!Array.isArray(data)) {
                console.error("Formato inesperado do carrinho:", data);
                return [];
            }
            return data;
        } catch (error) {
            console.error("Erro ao buscar carrinho:", error);
            return [];
        }
    },

    addItem: async function(productId, quantity = 1) {
        const userId = this.getUserId();
        const token = this.getToken();
        if (!userId || !token) {
            window.location.href = `${basePath}pages/login.html`;
            return;
        }

        try {
            await fetch(`${API_CONFIG.BASE_URL}/cart/${userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ productId, quantity })
            });
            this.updateCartCount();
        } catch (error) {
            console.error("Erro ao adicionar item:", error);
        }
    },

    updateQuantity: async function(productId, newQuantity) {
        const userId = this.getUserId();
        const token = this.getToken();
        if (!userId || !token) return;

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/cart/${userId}/${productId}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ quantity: newQuantity })
            });
            await this.updateCartCount();
            return await response.json();
        } catch (error) {
            console.error("Erro ao atualizar quantidade:", error);
        }
    },

    removeItem: async function(productId) {
        const userId = this.getUserId();
        const token = this.getToken();
        if (!userId || !token) return; 

        try {
            await fetch(`${API_CONFIG.BASE_URL}/cart/${userId}/${productId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            await this.updateCartCount();
        } catch (error) {
            console.error("Erro ao remover item:", error);
        }
    },

    updateSubscription: async function(productId, isSubscribed) {
        const userId = this.getUserId();
        const token = this.getToken();
        if (!userId || !token) return;

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/cart/${userId}/${productId}/subscribe`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ isSubscribed: isSubscribed })
            });
            await this.updateCartCount();
            return await response.json();
        } catch (error) {
            console.error("Erro ao atualizar o estado da assinatura:", error);
        }
    },

    updateCartCount: async function() {
        const userId = this.getUserId();
        const cartCountElement = document.getElementById('cart-count');
        if (!cartCountElement) return;

        if (!userId) {
            cartCountElement.textContent = 0;
            cartCountElement.classList.add('hidden');
            return;
        }

        const cart = await this.getCart();
        const count = cart.reduce((total, item) => total + item.quantity, 0);

        cartCountElement.textContent = count;
        cartCountElement.classList.toggle('hidden', count === 0);
    }
};

// Atualiza a contagem quando a página é carregada
document.addEventListener('DOMContentLoaded', () => CartManager.updateCartCount());

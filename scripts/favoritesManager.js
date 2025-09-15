const FavoritesManager = {
    getUser: function() {
        return JSON.parse(localStorage.getItem('loggedInUser'));
    },

    getFavorites: async function() {
        const user = this.getUser();
        if (!user || !user.id || !user.token) return [];
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/favorites/${user.id}`, {
                headers: { 
                    'Authorization': `Bearer ${user.token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) throw new Error("Erro ao buscar favoritos.");
            return await response.json();
        } catch (error) {
            console.error("Erro ao buscar favoritos:", error);
            return [];
        }
    },

    isFavorite: async function(productId) {
        const favorites = await this.getFavorites();
        return Array.isArray(favorites) && favorites.includes(productId);
    },

    addFavorite: async function(productId) {
        const user = this.getUser();
        if (!user || !user.id || !user.token) {
            window.location.href = `${basePath}pages/login.html`;
            return;
        }
        await fetch(`${API_CONFIG.BASE_URL}/favorites/${user.id}`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${user.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ productId })
        });
    },

    removeFavorite: async function(productId) {
        const user = this.getUser();
        if (!user || !user.id || !user.token) return;
        await fetch(`${API_CONFIG.BASE_URL}/favorites/${user.id}/${productId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${user.token}` }
        });
    }
};

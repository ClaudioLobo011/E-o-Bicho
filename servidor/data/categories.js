const categories = [
    // ================== CACHORRO ==================
    {
        name: 'Cachorro',
        children: [
            { name: 'Ração', children: [ { name: 'Ração Seca' }, { name: 'Ração Úmida' }, { name: 'Ração Prescrita' }, { name: 'Ração Natural' } ] },
            { name: 'Petiscos e Ossos', children: [ { name: 'Cuidado Oral' }, { name: 'Petiscos Naturais' }, { name: 'Bifinhos' }, { name: 'Biscoitos' }, { name: 'Bolos e Chocolates' }, { name: 'Bebidas e Molhos' }, { name: 'Ossinhos' }, { name: 'Petiscos Cremosos' } ] },
            { name: 'Tapetes, Fraldas e Banheiros', children: [ { name: 'Tapetes Higiênicos' }, { name: 'Fraldas' }, { name: 'Banheiros' }, { name: 'Cones' } ] },
            { name: 'Farmácia', children: [ { name: 'Antipulgas e Carrapatos' }, { name: 'Demais Medicamentos' }, { name: 'Anti-inflamatórios' }, { name: 'Antibióticos' }, { name: 'Suplementos e Vitaminas' }, { name: 'Vermífugos' }, { name: 'Homeopáticos e Florais' }, { name: 'Oftalmológicos' }, { name: 'Otológicos' }, { name: 'Cuidado Oral' }, { name: 'Banho Terapêutico' }, { name: 'Roupas Cirúrgicas' }, { name: 'Colares Elizabetanos' } ] },
            { name: 'Brinquedos', children: [ { name: 'Bichinhos de Pelúcia' }, { name: 'Brinquedos de Nylon' }, { name: 'Brinquedos Educativos' }, { name: 'Brinquedos de Corda' }, { name: 'Frisbees' }, { name: 'Mordedores' } ] },
            { name: 'Coleiras, Guias e Peitorais', children: [ { name: 'Coleiras' }, { name: 'Guias' }, { name: 'Peitorais' } ] },
            { name: 'Beleza e Limpeza', children: [ { name: 'Banho à Seco e Talcos' }, { name: 'Sabonetes' }, { name: 'Shampoos e Condicionadores' }, { name: 'Hidratantes' }, { name: 'Perfumes e Colônias' }, { name: 'Higiene Bucal' }, { name: 'Pentes, Escovas e Rasqueadeiras' }, { name: 'Lenços Umedecidos' }, { name: 'Limpeza de Olhos e Ouvidos' }, { name: 'Maquina de Tosa e Acessórios' }, { name: 'Alicates e Tesouras' }, { name: 'Coletor de Fezes' }, { name: 'Eliminador de Odores e Desinfetantes' }, { name: 'Educadores, Repelentes e Atrativos' } ] },
            { name: 'Camas e Cobertores', children: [ { name: 'Almofadas e Colchonetes' }, { name: 'Camas' }, { name: 'Edredons, Cobertores e Mantas' } ] },
            { name: 'Casas e Tocas', children: [ { name: 'Casas' }, { name: 'Tocas' } ] },
            { name: 'Acessórios de Alimentação', children: [ { name: 'Fontes' }, { name: 'Dosadores de Ração' }, { name: 'Porta Ração' }, { name: 'Comedouros' }, { name: 'Bebedores' }, { name: 'Jogo Americano' }, { name: 'Mamadeiras' } ] },
            { name: 'Acessórios de Transporte', children: [ { name: 'Caixa de Transporte' }, { name: 'Bolsas de Transporte' }, { name: 'Carrinhos' }, { name: 'Cintos de Segurança' }, { name: 'Cadeirinhas' }, { name: 'Capas para Banco de Carro' } ] },
            { name: 'Portões, Grades e Escadas', children: [ { name: 'Portões' }, { name: 'Grades' }, { name: 'Canil' }, { name: 'Portas' }, { name: 'Escadas' } ] },
            { name: 'Roupas', children: [ { name: 'Roupas de Inverno' }, { name: 'Roupas de Verão' }, { name: 'Diversos' } ] },
            { name: 'Adestramento e Comportamento', children: [ { name: 'Acessórios para Treinamento' }, { name: 'Focinheiras e Enforcadeiras' } ] },
            { name: 'Raças', children: [ { name: 'Spitz Alemão' }, { name: 'Pug' }, { name: 'Yorkshire' }, { name: 'Pinscher' }, { name: 'Shih Tzu' }, { name: 'Lhasa Apso' }, { name: 'Pitbull' }, { name: 'Border Collie' }, { name: 'Bull Terrier' }, { name: 'Chow Chow' }, { name: 'Bulldog Inglês' }, { name: 'Rottweiler' }, { name: 'Husky Siberiano' }, { name: 'Golden Retriever' }, { name: 'Pastor Alemão' } ] },
            { name: 'Marcas', children: [ { name: 'Royal Canin' }, { name: 'N&D' }, { name: 'Hill\'s' }, { name: 'Nestlé Purina' }, { name: 'Premier Pet' }, { name: 'Bravecto' }, { name: 'Zoetis' }, { name: 'Ourofino' }, { name: 'Organnact' }, { name: 'Zee.Dog' }, { name: 'Super Secão' }, { name: 'Club Pet' } ] },
        ]
    },
    // ================== GATO ==================
    {
        name: 'Gato',
        children: [
            { name: 'Ração', children: [ { name: 'Ração Seca' }, { name: 'Ração Úmida' }, { name: 'Ração Prescrita' }, { name: 'Ração Natural' } ] },
            { name: 'Petiscos', children: [ { name: 'Biscoitos' }, { name: 'Bifinhos' }, { name: 'Petiscos Cremosos' } ] },
            { name: 'Areias e Banheiros', children: [ { name: 'Areias' }, { name: 'Sílicas' }, { name: 'Caixas de Areia' }, { name: 'Banheiros' }, { name: 'Acessórios Sanitários' } ] },
            { name: 'Farmácia', children: [ { name: 'Antipulgas e carrapatos' }, { name: 'Vermífugos' }, { name: 'Suplementos e Vitaminas' }, { name: 'Antibióticos' }, { name: 'Anti-inflamatórios' }, { name: 'Banho Terapêutico' }, { name: 'Colares Elizabetanos' }, { name: 'Homeopáticos e Florais' }, { name: 'Demais Medicamentos' }, { name: 'Oftalmológicos' }, { name: 'Otológicos' }, { name: 'Roupas Cirúrgicas' } ] },
            { name: 'Arranhadores e Brinquedos', children: [ { name: 'Arranhadores' }, { name: 'Brinquedos com Erva do Gato' }, { name: 'Brinquedos Educativos' }, { name: 'Ratinhos e Bolinhas' }, { name: 'Varinhas' } ] },
            { name: 'Beleza e Limpeza', children: [ { name: 'Alicates e Tesouras' }, { name: 'Banho à Seco e Talcos' }, { name: 'Higiêne Bucal' }, { name: 'Lenços Umedecidos' }, { name: 'Limpeza de Olhos e Ouvidos' }, { name: 'Máquina de Tosa e Acessórios' }, { name: 'Pentes, Escovas e Rasqueadeiras' }, { name: 'Perfume e Colónias' }, { name: 'Sabonetes' }, { name: 'Shampoos e Condicionadores' }, { name: 'Hidratantes' }, { name: 'Eliminador de Odores e Desinfetantes' }, { name: 'Educadores, Repelentes e Atrativos' } ] },
            { name: 'Coleiras e Peitorais', children: [ { name: 'Coleiras' }, { name: 'Peitorais' } ] },
            { name: 'Acessórios de Alimentação', children: [ { name: 'Bebedouros' }, { name: 'Comedouros' }, { name: 'Fontes' }, { name: 'Jogo Americano' }, { name: 'Mamadeiras' }, { name: 'Porta Ração' }, { name: 'Dosadores de Ração' } ] },
            { name: 'Acessórios de Transporte', children: [ { name: 'Caixa de Transporte' }, { name: 'Bolsas de Transporte' }, { name: 'Cadeirinhas' }, { name: 'Cintos de Segurança' }, { name: 'Capas para Banco de Carro' }, { name: 'Carrinhos' } ] },
            { name: 'Camas, Almofadas e Tocas', children: [ { name: 'Camas' }, { name: 'Tocas' }, { name: 'Almofadas' } ] },
            { name: 'Roupas', children: [ { name: 'Roupas de Inverno' }, { name: 'Roupas de Verão' } ] },
            { name: 'Raças', children: [ { name: 'Persa' }, { name: 'Siamês' }, { name: 'Ragdoll' }, { name: 'Angorá' }, { name: 'Gato Vira Lata' }, { name: 'American Shorthair' }, { name: 'Abissínio' }, { name: 'Sphynx' }, { name: 'British Shorthair' }, { name: 'Exótico' }, { name: 'Himalaio' } ] },
            { name: 'Marcas', children: [ { name: 'Royal Canin' }, { name: 'Hill\'s' }, { name: 'N&D' }, { name: 'Nestle Purina' }, { name: 'Whiskas' }, { name: 'Premier Pet' }, { name: 'Bravecto' }, { name: 'Frontline' }, { name: 'Organnact' }, { name: 'Agener União' }, { name: 'Chalesco' }, { name: 'Pipicat' }, { name: 'Fuminator' } ] },
        ]
    },
    // ================== PÁSSAROS ==================
    {
        name: 'Pássaros',
        children: [
            { name: 'Alimentação', children: [ { name: 'Calopsita' }, { name: 'Trinca-Ferro' }, { name: 'Papagaio' }, { name: 'Periquito' }, { name: 'Beija-flor' }, { name: 'Sabiá' }, { name: 'Canário' }, { name: 'Outras Espécies' } ] },
            { name: 'Gaiolas e Viveiros', children: [ { name: 'Gaiolas' }, { name: 'Viveiros' } ] },
            { name: 'Brinquedos e Poleiros', children: [ { name: 'Brinquedos' }, { name: 'Poleiros' } ] },
            { name: 'Acessórios', children: [ { name: 'Porta Frutas e Porta Vitaminas' }, { name: 'Bebedouros' }, { name: 'Comedouros' }, { name: 'Banheiras' }, { name: 'Ninhos' }, { name: 'Bica Pedra' }, { name: 'Higiene' } ] },
            { name: 'Farmácia', children: [ { name: 'Vitaminas' }, { name: 'Vermífugos' }, { name: 'Antibióticos' }, { name: 'Medicamentos' } ] },
        ]
    },
    // ================== PEIXE ==================
    {
        name: 'Peixe',
        children: [
            { name: 'Alimentação', children: [ { name: 'Alimento Base' }, { name: 'Peixes de Fundo' }, { name: 'Peixe Betta' }, { name: 'Ciclídeos' }, { name: 'Kinguios e Carpas' }, { name: 'Peixes Carnívoros' }, { name: 'Peixes Marinhos' }, { name: 'Outras Espécies' } ] },
            { name: 'Equipamentos e Acessórios', children: [ { name: 'Alimentador Automático' }, { name: 'Filtros e Mídias' }, { name: 'Iluminação' }, { name: 'Bombas e Compressores' }, { name: 'Termostatos e Termômetros' }, { name: 'Aquecedores' }, { name: 'Sifão' }, { name: 'Limpadores' }, { name: 'Criadeiras' } ] },
            { name: 'Aquários e Beteiras', children: [ { name: 'Aquário Kit' }, { name: 'Aquário Base' }, { name: 'Beteiras' } ] },
            { name: 'Tratamento de Água', children: [ { name: 'Condicionadores de Água' }, { name: 'Testes de Água' } ] },
            { name: 'Decoração', children: [ { name: 'Substratos' }, { name: 'Rochas e Troncos' }, { name: 'Enfeites' } ] },
            { name: 'Farmácia', children: [ { name: 'Suplementos' }, { name: 'Medicamentos' } ] },
        ]
    },
    // ================== OUTROS PETS ==================
    {
        name: 'Outros Pets',
        children: [
            { name: 'Coelhos', children: [ { name: 'Ração' }, { name: 'Gaiolas e Casinhas' }, { name: 'Serragem e Granulados' }, { name: 'Feno e Alfafa' }, { name: 'Brinquedos' }, { name: 'Higiene' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Acessórios' } ] },
            { name: 'Hamster e Twister', children: [ { name: 'Ração' }, { name: 'Gaiolas e Casinhas' }, { name: 'Serragem e Granulados' }, { name: 'Feno e Alfafa' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Brinquedos' }, { name: 'Higiene' }, { name: 'Acessórios' } ] },
            { name: 'Porquinho da Índia', children: [ { name: 'Ração' }, { name: 'Gaiolas e Casinhas' }, { name: 'Feno e Alfafa' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Brinquedos' }, { name: 'Higiene' }, { name: 'Acessórios' } ] },
            { name: 'Chinchilas', children: [ { name: 'Ração' }, { name: 'Gaiolas e Casinhas' }, { name: 'Serragem e Granulados' }, { name: 'Feno e Alfafa' }, { name: 'Brinquedos' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Higiene' }, { name: 'Acessórios' } ] },
            { name: 'Gerbil', children: [ { name: 'Ração' }, { name: 'Gaiolas e Casinhas' }, { name: 'Serragem e Granulados' }, { name: 'Feno e Alfafa' }, { name: 'Brinquedos' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Acessórios' } ] },
            { name: 'Furão', children: [ { name: 'Ração' }, { name: 'Gaiolas e Casinhas' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Acessórios' } ] },
            { name: 'Tartarugas', children: [ { name: 'Ração' }, { name: 'Aquaterrários' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Tocas' }, { name: 'Acessórios' } ] },
            { name: 'Lagartos', children: [ { name: 'Ração' }, { name: 'Aquaterrários' }, { name: 'Medicamentos e Vitaminas' }, { name: 'Tocas' }, { name: 'Acessórios' } ] },
        ]
    },
    // ================== CASA E JARDIM ==================
    {
        name: 'Casa e Jardim',
        children: [
            { name: 'Jardim', children: [ { name: 'Sementes' }, { name: 'Vasos e Pratos' }, { name: 'Terras e Substratos' }, { name: 'Adubos e Fertilizantes' }, { name: 'Enfeites e Decoração' }, { name: 'Regadores e Pulverizadores' }, { name: 'Acessórios de Jardinagem' } ] },
            { name: 'Piscina', children: [ { name: 'Cloro para Piscina' }, { name: 'Algicidas' }, { name: 'Clarificantes' }, { name: 'Decantador' }, { name: 'Limpa Bordas' }, { name: 'Regulador de PH' }, { name: 'Teste de Piscina' } ] },
            { name: 'Controle de Pragas', children: [ { name: 'Raticidas' }, { name: 'Repelentes' }, { name: 'Inseticidas' } ] },
            { name: 'Casa e Ambiente', children: [ { name: 'Aromatizadores e Difusores' }, { name: 'Diversos' } ] },
            { name: 'Livros e Presentes', children: [ { name: 'Livros' }, { name: 'Presentes' } ] },
            { name: 'Conveniência', children: [ { name: 'Acessórios para Celular' } ] },
        ]
    }
];

module.exports = categories;
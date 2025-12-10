const axios = require('axios')
const instance = axios.create({ baseURL: 'https://bulbapedia.bulbagarden.net/wiki/' })

module.exports = {
    getPokemon: async (p, endpoint = "") => await instance.get(`${p.split(' ').join('_')}_(Pok%C3%A9mon)${endpoint}`)
}
const cheerio = require('cheerio')
const { parseID } = require('./utils/parseID')
const { getPokemon } = require('./utils/client')
const romanToRegular = require('./data/romanToRegular.json')
const regularToRoman = require('./data/regularToRoman.json')
const statMap = require('./data/statMap.json')

class CrawlPokemon {
    constructor(pokemon) {
        this.idMap = {
            tm: ['#By_TM', '#=By_TM', '#By_[[TM]', '#By_TM/HM', '#By_TM/TR'],
            tutor: '#By_tutoring',
            level: '#By_leveling_up',
            egg: '#By_breeding',
            stats: '#Stats'
        }
        this.hasRetriedLoad = false
        this.pokemon = pokemon.replace('’', "'")
        this.pokemonGen = null
        this.currentGen = 9
        this.type = null
        this.store = {}
        this.$ = null
    }

    #init = async () => {
        if (!this.store.default) {
            console.error(`Couldn't load pokemon data`)
            return false
        }
        this.$ = this.store.default
        if (this.currentGen < 9 && this.type !== 'tm') {
            const roman = regularToRoman[this.currentGen]
            const endpoint = `/Generation_${roman}_learnset${this.idMap[this.type]}`
            if (!await this.#setStore(roman, endpoint)) return false
        }
        return true
    }

    #setStore = async (gen, endpoint) => {
        try {
            if (!this.store[gen]) {
                const t = await getPokemon(this.pokemon, endpoint)
                this.store[gen] = cheerio.load(t.data)
            }
            this.$ = this.store[gen]
            return true
        } catch (e) {
            console.error(`HTTP: ${e?.status || 500} | ${gen} | ${endpoint}`)
            return false
        }
    }

    #parseData = (data) => {
        const final = {}
        final[this.pokemon] = data
        return final
    }

    #getPokemonGen = () => {
        const text = this.store.default('.infobox').nextAll('p').first().find('a[title^=Generation]').first().text()
        const parsed = text.toLowerCase().replace('generation', '').trim().toUpperCase()
        const genParsed = parseInt(romanToRegular[parsed])
        this.pokemonGen = genParsed || 9
    }

    #getTableHeader = (forme) => {
        const id = forme || this.idMap[this.type]
        let h = null
        if (typeof id === 'string') {
            const header = this.$(parseID(id))
            if (header.html()) h = header.parent()
        } else {
            for (const i of id) {
                const header = this.$(parseID(i))
                if (!header.html()) continue
                h = header.parent()
                break
            }
        }
        return h
    }

    #getFormeNameIDs = () => {
        const header = this.#getTableHeader()
        if (!header) return false
        const startingHeaderElementNumber = parseInt(header.get(0).tagName.replace('h', ''))
        const headerIncrement = 1
        const headerElements = header.nextAll(`h${startingHeaderElementNumber}, h${startingHeaderElementNumber + headerIncrement}`).get()
        const firstMainHeaderIndex = headerElements.findIndex(el => el.tagName === `h${startingHeaderElementNumber}`)
        const formeHeaders = firstMainHeaderIndex <= -1 ? headerElements : headerElements.slice(0, firstMainHeaderIndex)
        return Object.fromEntries([[this.$(formeHeaders[0]).text().trim() || this.pokemon, this.idMap[this.type]], ...formeHeaders.slice(1).map(f => [this.$(f).text().trim(), this.$(f).find('span').last().attr('id')])])
    }

    #getMovesTable = (forme) => {
        const header = this.#getTableHeader(forme)
        if (!header) return null
        const table = header.nextAll('.roundy, .expandable, .collapsible-block').first()
        if (table.html()) {
            if (table.hasClass('expandable') || table.hasClass('collapsible-block')) return table.find('table[class=roundy]')
            return table
        }
        return null
    }

    #getStatTables = () => {
        const statsHeader = this.$(this.idMap.stats).parent()
        const tagName = statsHeader.get(0).tagName
        const rawTables = statsHeader.nextUntil(tagName).filter('table').get()
        return Object.fromEntries(rawTables.map(e => {
            const t = this.$(e)
            const header = t.prev().find('span').text().trim()
            return [header, t]
        }))
    }

    #getTableColumnNames = (table) => {
        const rowIndex = table.hasClass('sortable') ? 0 : 1
        const colList = table.find('tbody').children('tr').eq(rowIndex).find('th').get()
        const cols = []
        for (let c = 0; c < colList.length; c++) {
            const checkSpan = parseInt(this.$(colList[c]).attr('colspan'))
            if (!isNaN(checkSpan)) {
                for (let i = 0; i < checkSpan - 1; i++) {
                    cols.push('')
                }
            }
            cols.push(this.$(colList[c]).text().trim())
        }
        return cols
    }

    #getCurrentGen = (table) => table.find('tbody > tr > td[class=roundytop] > table > tbody > tr > th').eq(0).text().split('Generation').pop().trim()

    #getOtherGens = (table) => {
        const data = {}
        const gens = table.find('table[class=roundy] > tbody > tr').eq(2).find('th > a').map((i, el) => this.$(el).attr('href')).get()
        for (const g of gens) {
            const endpoint = `/Generation${g.split('/Generation').pop()}`.split('#')[0]
            const name = endpoint.split('_')[1]
            const verify = parseInt(romanToRegular[name])
            if (isNaN(verify)) continue
            if (verify > this.currentGen) continue
            data[name] = endpoint
        }
        return data
    }

    #getStatsFromTable = (table) => {
        const rows = table.find('tbody').first().children('tr').slice(2).get()
        return rows.map(el => {
            const divs = this.$(el).find('th').first().find('div')
            const key = (divs.first().find('span').text() || divs.first().text()).replace(':', '')
            return [key, divs.last().text()]
        }).reduce((acc, [k, v]) => {
            const key = statMap[k]
            if (key) {
                if (!acc[key]) acc[key] = {}
                acc[key] = parseInt(v)
            }
            return acc
        }, {})
    }

    #getMovesFromTable = (table) => {
        const subTable = table.find('tbody > tr table[class=sortable]')
        const t = subTable.html() ? subTable : table
        const sliceStart = t.hasClass('sortable') ? 1 : 2
        const sliceEnd = t.hasClass('sortable') ? undefined : -1
        const cols = this.#getTableColumnNames(t)
        const moveColIndex = cols.indexOf('Move')

        switch (this.type.toLowerCase()) {
            case 'tm': case 'tutor': case 'egg': {
                const rows = t.find('tbody').first().children('tr')
                const sliced = sliceEnd ?
                    rows.slice(sliceStart, sliceEnd) :
                    rows.slice(sliceStart)
                return sliced
                    .filter((i, el) => this.$(el).find('td').length > 0)
                    .map((i, el) => this.$(el).find('td').eq(this.type === 'tutor' ? 0 : moveColIndex).find('span').text()).get()
            }
            case 'level': {
                let levelColIndex = cols.findIndex(c => ['Level', 'Learn'].includes(c))
                if (levelColIndex <= -1) levelColIndex = moveColIndex - 1
                return t.find('tbody').first().children('tr').slice(1).get().map((el) => {
                    const rowData = this.$(el).find('td').eq(levelColIndex)
                    const l = parseInt(rowData.find('span[style=display:none]').text())
                    const expicit = rowData.find('span').last()
                    const key = isNaN(l) ? expicit.text().trim() || rowData.text().trim() : l
                    return [key, this.$(el).find('td').eq(moveColIndex).find('span').text()]
                }).reduce((acc, [k, v]) => {
                    const key = typeof k === 'string' ? k.replace('.', '').replace('*', '').toLowerCase() : k
                    if (key) {
                        if (!acc[key]) acc[key] = []
                        acc[key].push(v)
                    }
                    return acc
                }, {})
            }
        }
    }

    #getStats = async () => {
        await this.#init()
        const data = {}
        const tables = this.#getStatTables()
        for (const t in tables) {
            if (t === 'Pokéathlon stats') continue
            data[t] = this.#getStatsFromTable(tables[t])
        }
        return data
    }

    #getMoves = async () => {
        await this.#init()
        const data = {}
        let formes = this.#getFormeNameIDs()
        while (!formes && this.currentGen > this.pokemonGen) {
            this.currentGen -= 1
            await this.#init()
            formes = this.#getFormeNameIDs()
        }
        for (const f in formes) {
            data[f] = {}
            const table = this.#getMovesTable(formes[f])
            if (!table) continue
            const currentGen = this.#getCurrentGen(table)
            data[f][romanToRegular[currentGen]] = this.#getMovesFromTable(table)
            if (!this.fetchAllGens) {
                await this.#init()
                continue
            }
            const otherGens = this.#getOtherGens(table)
            for (const e in otherGens) {
                if (!await this.#setStore(e, otherGens[e])) continue
                const currentFormes = this.#getFormeNameIDs()
                if (!currentFormes) continue
                for (const cf in currentFormes) {
                    const currentTable = this.#getMovesTable(currentFormes[cf])
                    if (!currentTable) continue
                    if (!data[cf]) data[cf] = {}
                    const genRegular = romanToRegular[e]
                    if (data[cf][genRegular]) continue
                    data[cf][genRegular] = this.#getMovesFromTable(currentTable)
                }
            }
            await this.#init()
        }
        return data
    }

    load = async () => {
        try {
            const data = await getPokemon(this.pokemon)
            this.store.default = cheerio.load(data.data)
            const init = await this.#init()
            if (init) {
                this.#getPokemonGen()
                if (!this.pokemonGen) {
                    console.log(`Couldn't find pokemon generation: ${this.pokemon}`)
                    return false
                }
            }
            return init
        } catch (e) {
            if (this.hasRetriedLoad || e?.status !== 404) {
                console.error(`HTTP: ${e?.status || 500} | ${this.pokemon}`)
                console.log(e)
                return false
            }
            const pokemonNameSplit = this.pokemon.split(' ')
            if (pokemonNameSplit.length <= 1) return false
            const pokemonNameFixed = pokemonNameSplit[0]
            this.pokemon = pokemonNameFixed
            this.hasRetriedLoad = true
            await this.load()
        }
    }

    getStats = async () => {
        this.type = 'stats'
        return this.#parseData(await this.#getStats())
    }

    getTmMoves = async (all = false) => {
        this.type = 'tm'
        this.fetchAllGens = all
        return this.#parseData(await this.#getMoves(all))
    }

    getTutorMoves = async (all = false) => {
        this.type = 'tutor'
        this.fetchAllGens = all
        return this.#parseData(await this.#getMoves(all))
    }

    getLevelMoves = async (all = false) => {
        this.type = 'level'
        this.fetchAllGens = all
        return this.#parseData(await this.#getMoves(all))
    }

    getEggMoves = async (all = false) => {
        this.type = 'egg'
        this.fetchAllGens = all
        return this.#parseData(await this.#getMoves(all))
    }
}

module.exports = { CrawlPokemon }
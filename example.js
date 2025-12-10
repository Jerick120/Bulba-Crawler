const { CrawlPokemon } = require('./index')
const fs = require('fs')

const data = []
const failed = []
const getData = async () => {
    const pokemonNames = ['Lopunny', 'Dragonite', 'Zacian']
    console.log(`# Start fetching`)
    let c = 1
    for (const p of pokemonNames) {
        console.log(`= Fetching: ${p} [${c}/${pokemonNames.length}]${failed.length ? ` [Failed: ${failed.length}]` : ''}`)
        const crawler = new CrawlPokemon(p)
        if (!await crawler.load()) {
            failed.push(p)
            continue
        }
        console.log(`+ Crawler loaded`)
        console.log(`- Parsing Moves`)
        data.push(await crawler.getStats())
        // data.push(await crawler.getEggMoves(true))
        // data.push(await crawler.getLevelMoves(true))
        // data.push(await crawler.getTmMoves(true))
        // data.push(await crawler.getTutorMoves(true))
        console.log(`+ Parsed!\n`)
        c++
    }
    console.log(`# Writing to file`)
    fs.writeFileSync('./data.json', JSON.stringify(data))
    console.log(`+ Data written!`)
    if (failed.length) console.log(`Failed:`, failed)
}

getData()
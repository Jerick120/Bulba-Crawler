require('css.escape')
module.exports = {
    parseID: (id) => `#${CSS.escape(id.startsWith('#') ? id.slice(1) : id)}`
}
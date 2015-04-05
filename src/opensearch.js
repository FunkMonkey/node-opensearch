import OpenSearchProvider from "./opensearch-provider";

/**
 * Creates an OpenSearchProvider based on a given XML-String, JSON representation,
 * url or filesystem path
 *
 * @param  {(string|Object)}    osData     Datasource for the provider
 * @param  {Object}             [options]  Options. Define `type` with `xml`, `json`, `url` or `file`
 * @return {OpenSearchProvider}            The new Provider
 */
function createOpenSearchProvider( osData, options ) {

  var type = ( options && options.type ) || "xml";

  switch ( type ) {
    case "xml": return OpenSearchProvider.createFromXMLString( osData );
    case "file": return OpenSearchProvider.createFromFile( osData );
    default: return Promise.reject( new Error( "Type '" + type * "' not supported!" ) );
  }
}

createOpenSearchProvider.OpenSearchProvider = OpenSearchProvider;

export default createOpenSearchProvider;

import _ from "lodash";
import xml2js from "xml2js";
import URITemplate from "URIjs/src/URITemplate";
import URI from "URIjs";
import fetch from "node-fetch";
import fs from "fs";

var defaultOpenSearchDescription = {
  ShortName: "",
  Description: "",
  Tags: [],
  Contact: "",
  Url: [],
  LongName: "",
  Image: [],
  Query: null,
  Developer: "",
  Attribution: "",
  SyndicationRight: "open",
  AdultContent: false,
  Language: ["*"],
  OutputEncoding: ["UTF-8"],
  InputEncoding: ["UTF-8"]
};

var osArrayProperties = ["Image", "InputEncoding", "Language", "OutputEncoding", "Url"];

/**
 * OpenSearchProvider
 *
 * Creates an interface for executing OpenSearch searches as defined in
 * http://www.opensearch.org/Specifications/OpenSearch/1.1
 *
 * Also supports the Suggestions extension and Mozilla's version of the Parameter extension
 * http://www.opensearch.org/Specifications/OpenSearch/Extensions/Suggestions/1.1
 * http://www.opensearch.org/Specifications/OpenSearch/Extensions/Parameter/1.0
 */
export default class OpenSearchProvider {

  /**
   * Creates an instance of `OpenSearchProvider` from an XML string that represents
   * an OpenSearchDefinition. Returns a promise resolving to the instance
   *
   * @param  {string}  xmlString The XML string
   * @return {Promise}           The promise
   */
  static createFromXMLString( xmlString ) {

    return new Promise( (resolve, reject) => {
      xml2js.parseString(
        xmlString,
        { mergeAttrs: true,
          explicitArray: false,
          charkey: "src" },
        (err, res) => {

        if( err ) {
          reject( err );
        } else {
          // handling `OpenSearchDescription` as in spec 1.1 ans `SearchPlugin`, which is
          // used by Mozilla
          resolve( new OpenSearchProvider( res.OpenSearchDescription || res.SearchPlugin) );
        }

      } );
    } );
  }

  /**
   * Creates an instance of `OpenSearchProvider` from an XML file that represents
   * an OpenSearchDefinition. Returns a promise resolving to the instance
   *
   * @param  {string}  filePath  
   * @return {Promise}           The promise
   */
  static createFromFile( filePath ) {

    return new Promise( (resolve, reject) => {

      fs.readFile( filePath, ( err, xmlString ) => {

        if( err ) {
          reject( err );
          return;
        }

        xml2js.parseString(
          xmlString,
          { mergeAttrs: true,
            explicitArray: false,
            charkey: "src" },
          (err, res) => {

            if( err ) {
              reject( err );
            } else {
              // handling `OpenSearchDescription` as in spec 1.1 ans `SearchPlugin`, which is
              // used by Mozilla
              resolve( new OpenSearchProvider( res.OpenSearchDescription || res.SearchPlugin) );
            }
         } );
      } );
    } );
  }

  /**
   * Constructor
   *
   * @param  {object} osDefinition JSON definition for an OpenSearchDescription
   */
  constructor( osDefinition ) {

    var def = _.defaults( osDefinition, defaultOpenSearchDescription );

    // from here on some validating
    if( typeof def.Tags === "string" )
      def.Tags = def.Tags.split(" ");

    // put single elements for Array properties into an array
    osArrayProperties.forEach( prop => {
      if( !Array.isArray( def[prop] ) )
        def[prop] = [def[prop]];
    });

    // validating image. setting null if attribute did not exist
    def.Image.forEach( image => {
      image.height = ( "height" in image ) ? parseInt( image.height ) : null;
      image.width = ( "width" in image ) ? parseInt( image.width ) : null;
      image.type = image.type || null;
    } );

    // validating Urls
    def.Url.forEach( url => {
      url.rel = ( "rel" in url ) ? url.rel : "results";
      url.indexOffset = ( "indexOffset" in url ) ? parseInt( url.indexOffset ) : 1;
      url.pageOffset = ( "pageOffset" in url ) ? parseInt( url.pageOffset ) : 1;

      // Mozilla Param Extension
      // TODO: rename to Parameter as in the extension of the OpenSearch Spec? What about the namespace?
      url.method = ( url.method && url.method.toLowerCase() ) || "get";
      if( "Param" in url) {
        if( !Array.isArray( url.Param ))
          url.Param = [url.Param];

        url.Param = url.Param.reduce( ( result, val ) => { result[val.name] = val.value; return result; }, {} );
      } else {
        url.Param = {};
      }
    } );

    // create the expandable URITemplates
    this.urlTemplates = def.Url.map( url => {
      var newUrl = _.clone( url );
      newUrl.template = new URITemplate( newUrl.template );
      newUrl.Param = _.mapValues( newUrl.Param, val => new URITemplate( val ) );
      return newUrl;
    } );

    this.definition = def;
  }

  // requestURL(rel, type, parameters) {
  //   return new Promise( ( resolve, reject ) => {
  //     var urls = this.urlTemplates.filter( url => url.rel === rel && url.type === type );

  //     if( urls.length === 0 ){
  //       reject( new Error("No Url with rel '" + rel + "' and type '" + type + "'!") );
  //     } else {
  //       return fetch( urls[0].template.expand( parameters ) )
  //         .then( res => {
  //           return res.json();
  //         } )
  //         .then( json => {
  //           return json;
  //         } );
  //     }

  //   } );
  // }

  /**
   * Expends the URITemplate of a `get`-URI
   *
   * @param  {Object} url    URL object with template to expand
   * @param  {Object} params Template parameters to use for expansion
   * @return {string}        Expanded URL
   */
  _expandGetUrlTemplate( url, params ) {
    var template = new URI( url.template.expand( params ) );
    template.addQuery( _.mapValues( url.Param, val => decodeURIComponent(val.expand( params )) ) );
    return template.toString();
  }

  /**
   * Executes the given URL (expands it and makes a request)
   *
   * @param  {Object} url    URL object to make request to
   * @param  {Object} params Template parameters to use for expansion
   * @return {Promise}       Promise that resolves to the server-response
   */
  _makeRequest( url, params ) {
    if( url.method === "get" ) {
      return fetch( this._expandGetUrlTemplate( url, params ) );
    }
  }

  /**
   * Returns suggestions for this opensearch provider. Uses the the Suggestions extension
   * (http://www.opensearch.org/Specifications/OpenSearch/Extensions/Suggestions/1.1)
   *
   * Additionaly uses `text/html` url if found in the XML for generating the query url list
   *
   * @param  {Object} templateParams Template parameters to use for expansion. Should at least have `searchTerms` set.
   * @return {Promise}               Promise that resolves to the server response as defined in
   *                                 http://www.opensearch.org/Specifications/OpenSearch/Extensions/Suggestions/1.1#Response_content
   */
  getSuggestions( templateParams ) {

    var url = _.find( this.urlTemplates, url => url.type === "application/x-suggestions+json" );

    if( !url )
      return Promise.reject( new Error("OpenSearchDefinition does not have a Url with type 'application/x-suggestions+json', which is necessary for suggestions!") );
    else
      return this._makeRequest( url, templateParams )
        .then( response => {
          if (response.status >= 200 && response.status < 300) {
              return response.json();
            } else {
              return Promise.reject(new Error(response.statusText));
            }
        } )
        .then( json => {
          // 3rd (descriptions) and 4th (query urls) element of the result are optional, but
          // we can at least add the urls
          if( json.length < 4 ) {
            // we're using the 'text/html' for creating the query urls
            var htmlUrl = _.find( this.urlTemplates, url => url.type === "text/html" );
            if( !htmlUrl )
              return json;

            if ( json.length < 3 ) // no point in adding empty array, if we don't have urls
              json.push([]); // specification is unclear, if we need same amount of elements, so we'll leave it empty for now


            var params = Object.create( templateParams );
            var urls = json[1].map( searchTerm => {
              params.searchTerms = searchTerm;
              return this._expandGetUrlTemplate( htmlUrl, params );
            });

            json.push( urls );
          }

          return json;
        });
  }

}

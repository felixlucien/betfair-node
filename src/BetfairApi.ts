import querystring from "query-string";
import axios from "axios";

import { BetStatus, MarketFilter, MarketSort, OrderProjection, PlaceInstruction, SortDir } from "./BetfairApiTypes";
import { BetfairExchangeStream } from "./BetfairExchangeStreamApi";
import { CurrencyRate, MarketChangeCallback } from "./BetfairExchangeStreamApiTypes";
import { generatePacketID } from "./Utils";

const AUTH_URLS = {
    interactiveLogin: 'https://identitysso.betfair.com.au:443/api/login',
    botLogin: 'https://identitysso-api.betfair.com.au:443/api/certlogin',
    logout: 'https://identitysso.betfair.com.au:443/api/logout',
    keepAlive: 'https://identitysso.betfair.com.au:443/api/keepAlive'
};

const BETTING_URLS = {
    exchange: "https://api.betfair.com:443/exchange/betting/json-rpc/v1",
}

const ACCOUNT_URLS = {
    accounts: "https://api.betfair.com/exchange/account/json-rpc/v1"
}

export class BetfairApi {
    public betfairExchangeStreamApi: BetfairExchangeStream;
    private locale: string; //Our target language
    private sessionKey: string; //This is required to authenticate your requests
    private appKey: string;
    private currencyRates: CurrencyRate[]; 
    private targetCurrency: string;
    private conflateMS: number;
    private heartbeatMS: number;
    private marketChangeCallback: MarketChangeCallback;

    constructor(
        locale: string, 
        currencyCode: string, 
        conflateMS: number, 
        heartbeatMS: number,
        marketChangeCallback: MarketChangeCallback
    ) {
        this.locale = locale;
        this.targetCurrency = currencyCode;
        this.conflateMS = conflateMS;
        this.heartbeatMS = heartbeatMS;
        this.marketChangeCallback = marketChangeCallback;
    }

    /*
    *   Return a dictionary of marketIds which the stream is subscribed to
    */
    public getStreamCache() {
        return this.betfairExchangeStreamApi.getCache();
    }
    
    private performLogin(appKey: string, username: string, password: string) {
        let formData = querystring.stringify({
            username: username,
            password: password,
            login: true,
            redirectMethod: 'POST',
            product: 'home.betfair.int',
            url: 'https://www.betfair.com/'
        });
    
        return axios({
            method: 'post',
            url: AUTH_URLS.interactiveLogin,
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
                'content-length': formData.length,
                'x-application': appKey
            },
            data: formData
        });
    }
    
    /*
    *   Create an exchangeStream instance, this can be used
    *   to keep track of odds in real time
    */
    public createStream(currencyCode: string) {
        var targetCurrency = this.currencyRates.filter(x => x.currencyCode === currencyCode)[0];
        if(!targetCurrency) {
            throw `Can't find the currency rate for ${currencyCode}!`;
        }
        this.betfairExchangeStreamApi = new BetfairExchangeStream(
            this.sessionKey,
            this.appKey,
            false,
            this.conflateMS,
            this.heartbeatMS,
            targetCurrency,
            this.marketChangeCallback,
        );
    }

    /*
    *   Login using a username, password and appKey (UNSAFE), note the 
    *   best way to login for a bot is using certificate login
    */
    async login(appKey: string, username: string, password: string) {
        var authCredentials = await this.performLogin(appKey, username, password);
        if(authCredentials.data.status === "SUCCESS") {
            this.appKey = appKey;
            this.sessionKey = authCredentials.data.token;
        } else {
            throw "Login failed!";
        }
        var currencyRes = await this.listCurrencyRates("GBP");
        if(currencyRes.status !== 200) {
            throw "Error, listing currency rates";
        }
        this.currencyRates = currencyRes.data.result;
    }
    
    logout(sessionKey: string) {
        let formData = querystring.stringify({
            product: 'home.betfair.int',
            url: 'https://www.betfair.com/'
        });
    
        return axios({
            method: 'post',
            url: AUTH_URLS.logout,
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
                'content-length': formData.length,
                "x-authentication": sessionKey
            },
            data: formData
        });
    }
    
    keepAlive(sessionKey: string) {
        let formData = querystring.stringify({
            product: 'home.betfair.int',
            url: 'https://www.betfair.com/'
        });
    
        return axios({
            method: 'post',
            url: AUTH_URLS.keepAlive,
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
                'content-length': formData.length,
                "x-authentication": sessionKey
            },
            data: formData
        });
    }
    
    devApiFilter(method: string, filter: MarketFilter) {
        return this.bettingApi(method, {
            "filter": filter,
            "locale": this.locale
        }, this.sessionKey, this.appKey);
    }
    
    bettingApi(method: string, params: any, sessionKey: string, appKey: string) {
        var def = {
            "jsonrpc": "2.0",
            "method": "SportsAPING/v1.0/" + method,
            "params": params,
            "id": generatePacketID()
        };
        return this.makeRequest(BETTING_URLS.exchange, JSON.stringify(def), sessionKey, appKey);
    }

    accountApi(method: string, params: any, sessionKey: string, appKey: string) {
        var def = {
            "jsonrpc": "2.0",
            "method": "AccountAPING/v1.0/" + method,
            "params": params,
            "id": generatePacketID()
        };
        return this.makeRequest(ACCOUNT_URLS.accounts, JSON.stringify(def), sessionKey, appKey);
    }
    
    makeRequest(url: string, def: string, sessionKey: string, appKey: string) {
        var formData = def;
        return axios({
            method: 'post',
            url: url,
            headers: {
                "accept": "application/json",
                "content-type": "application/json",
                'content-length': formData.length,
                "x-authentication": sessionKey,
                "x-application": appKey
            },
            data: formData
        });
    }
    
    listMarketCatalogue(
        filter: MarketFilter, 
        marketProjection: any[], 
        sort: MarketSort, 
        maxResults: number
    ) {
        return this.bettingApi("listMarketCatalogue", {
            "filter": filter,
            "marketProjection": marketProjection,
            "sort": sort,
            "maxResults": maxResults,
            "locale": this.locale
        }, this.sessionKey, this.appKey);
    }
    
    listMarketBook(params: any) {
        return this.bettingApi("listMarketBook", params, this.sessionKey, this.appKey);
    }

    listEventTypes(filter: MarketFilter) {
        return this.devApiFilter("listEventTypes", filter);
    }

    listCompetitions(filter: MarketFilter) {
        return this.devApiFilter("listCompetitions", filter);
    }

    listTimeRanges(filter: MarketFilter) {
        return this.devApiFilter("listTimeRanges", filter);
    }   

    listEvents(filter: MarketFilter) {
        return this.devApiFilter("listEvents", filter);
    }

    listMarketTypes(filter: MarketFilter) {
        return this.devApiFilter("listMarketTypes", filter);
    }

    listCountries(filter: MarketFilter) {
        return this.devApiFilter("listCountries", filter);
    }

    listVenues(filter: MarketFilter) {
        return this.devApiFilter("listVenues", filter);
    }

    listMarketProfitAndLoss(
        marketIds: string[], 
        includeSettledBets: boolean, 
        includeBspBets: boolean, 
        netOfCommission: boolean
    ) {
        return this.bettingApi("listMarketProfitAndLoss", {
            marketIds: marketIds,
            includeSettledBets: includeSettledBets,
            includeBspBets: includeBspBets,
            netOfCommission: netOfCommission,
            "locale": this.locale
        }, this.sessionKey, this.appKey);
    }

    listCurrentOrders(
        betIds: string[], 
        marketIds: string[], 
        orderProjection: OrderProjection, 
        placed: any, 
        orderBy: any, 
        sortDir: SortDir, 
        fromRecord: number, 
        recordCount: number
    ) {

    }

    listClearedOrders(
        betStatus: BetStatus, 
        eventTypeIds: string[], 
        eventIds: string[], 
        marketIds: string[], 
        runnerIds: number[], 
        betIds: any[], 
        side: any, 
        settledDateRange: any, 
        groupBy: any, 
        includeItemDescription: any, 
        fromRecord: number, 
        recordCount: number
    ) {

    }

    public placeOrders(
        marketId: string, 
        instructions: PlaceInstruction[], 
        customerRef: string, 
        marketVersion: number, 
        customerStrategyRef: string, 
        async: boolean
    ) {
        return this.bettingApi("placeOrders", {
            "marketId": marketId,
            "instructions": instructions,
            "customerRef": customerRef,
            "marketVersion": marketVersion,
            "customerStrategyRef": customerStrategyRef,
            "async": async,
            "locale": this.locale
        }, this.sessionKey, this.appKey);
    }

    cancelOrders() {

    }

    replaceOrders() {

    }

    updateOrders() {

    }

    public betfairStandardizeLocation(location: string): string {
        return "ERROR";
    }

    public listCurrencyRates(fromCurrency: string) {
        return this.accountApi("listCurrencyRates", {
            "fromCurrency": fromCurrency,
        }, this.sessionKey, this.appKey);
    }
}
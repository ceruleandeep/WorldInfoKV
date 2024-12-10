# WorldInfoKV

Exact matching of World Info entries to make WI more like a key/value store.

Mostly unimplemented, if it proves useful for people other than me I might try and get it merged.

**Notes**:

WI is not a KV store and it has many properties that make it unsuitable for that purpose.

* The `key` field is not a key, it is for "keywords".

* WI key fields are arrays! An entry can have multiple keys.

* Key fields are not unique! This is by design. You're not "supposed" to be able to reference a specific entry by key.

## Features

`/wikv-findentry`: adds `mode=` and `threshold=`

## Installation and Usage

### Installation

Install extension via the SillyTavern [Extension Manager](https://docs.sillytavern.app/extensions/).

### Usage

See context help for `/wikv-findentry` for details.

### Testing

```
// given actual key: "outfits-Galahad" |

/let case | /let match | /let nomatch |
/let test {: cond=
	/if left={{pipe}} rule=eq right="" else={: 
		/getentryfield file=Outfits field=key {{pipe}} | 
		/echo severity={{var::match}} {{var::case}} {{var::cond}} {{pipe}} 
	:} {: 
		/echo severity={{var::nomatch}} {{var::case}} {{var::cond}} Not found :}
:} |

/var case Valid | /var match success | /var nomatch warning |

/wikv-findentry file=Outfits "outfits-Galahad" |
/:test cond="Fuzz" |

/wikv-findentry file=Outfits mode=exact "outfits-Galahad" |
/:test cond="Exact" |

/var match warning | /var nomatch success | 

/var case Partial | 

/wikv-findentry file=Outfits "outfits" | 
/:test case="Fuzz" |

/wikv-findentry file=Outfits mode=exact "outfits" | 
/:test case="Exact" |

/var case Space | 

/wikv-findentry file=Outfits outfits Galahad | 
/:test cond="Fuzz" |

/wikv-findentry file=Outfits mode=exact outfits Galahad | 
/:test cond="Exact" |

/var case Quoted | 

/wikv-findentry file=Outfits "outfits Galahad" | 
/:test cond="Fuzz" |

/wikv-findentry file=Outfits mode=exact "outfits Galahad" | 
/:test cond="Exact" |

/var case Order | 

/var match success | /var nomatch warning |

/wikv-findentry file=Outfits mode=exact field=order 100 | 
/:test cond="Exact" |

/wikv-findentry file=Outfits field=order 100 | 
/:test cond="Fuzz" |
```

## Support and Contributions

*Where should someone ask for support?* https://docs.sillytavern.app/

## License

AGPL-3.0

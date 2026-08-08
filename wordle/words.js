// Wordle word lists.
// ANSWERS: curated common 5-letter words used as daily/random solutions.
// EXTRA_VALID: additional accepted guesses (uncommon words) that are NOT solutions.
// A guess is valid if it appears in ANSWERS or EXTRA_VALID.
(function (global) {
  "use strict";

  const ANSWERS = (
    "about above abuse actor acute admit adopt adult after again agent agree ahead " +
    "alarm album alert alike alive allow alone along alter among angel anger angle " +
    "angry apart apple apply arena argue arise array aside asset audio audit avoid " +
    "award aware badly baker bases basic beach began begin begun being below bench " +
    "billy birth black blame blank blast blind block blood board boast bobby boost " +
    "booth bound brain brand brass brave bread break breed brick brief bring broad " +
    "broke brown brush build built bunch burst buyer cabin cable calif carry catch " +
    "cause chain chair chaos charm chart chase cheap check chest chief child china " +
    "chose civil claim class clean clear click cliff climb clock close cloud coach " +
    "coast could count court cover craft crash crazy cream crime cross crowd crown " +
    "crude curve cycle daily dance dated dealt death debut delay depth doing doubt " +
    "dozen draft drama drank drawn dream dress drill drink drive drove dying eager " +
    "early earth eight elite empty enemy enjoy enter entry equal error event every " +
    "exact exist extra faith false fault fiber field fifth fifty fight final first " +
    "fixed flame flash fleet flesh float flood floor flour fluid focus force forth " +
    "forty forum found frame frank fraud fresh front fruit fully funny giant given " +
    "glass globe glory grace grade grain grand grant grass grave great green greet " +
    "gross group grown guard guess guest guide happy harry heart heavy hence henry " +
    "horse hotel house human ideal image index inner input issue japan jimmy joint " +
    "jones judge known label large laser later laugh layer learn lease least leave " +
    "legal level lewis light limit links lives local logic loose lower lucky lunch " +
    "lying magic major maker march maria match maybe mayor meant medal media metal " +
    "meter might minor minus mixed model money month moral motor mount mouse mouth " +
    "movie music needs never newly night noise north noted novel nurse occur ocean " +
    "offer often order other ought paint panel paper party peace peter phase phone " +
    "photo piece pilot pitch place plain plane plant plate point pound power press " +
    "price pride prime print prior prize proof proud prove queen quick quiet quite " +
    "radio raise range rapid ratio reach ready refer right rigid rival river robin " +
    "roger roman rough round route royal rural scale scene scope score sense serve " +
    "seven shall shape share sharp sheet shelf shell shift shine shirt shock shoot " +
    "short shown sight simon since sixth sixty sized skill sleep slide small smart " +
    "smile smith smoke solid solve sorry sound south space spare speak speed spend " +
    "spent split spoke sport staff stage stake stand start state steam steel stern " +
    "stick still stock stone stood store storm story strip stuck study stuff style " +
    "sugar suite super sweet table taken taste taxes teach teeth terry texas thank " +
    "theft their theme there these thick thing think third those three threw throw " +
    "tight times tired title today topic total touch tough tower track trade train " +
    "treat trend trial tried tries truck truly trust truth twice under undue union " +
    "unity until upper upset urban usage usual valid value video virus visit vital " +
    "voice waste watch water wheel where which while white whole whose woman women " +
    "world worry worse worst worth would wound wrong wrote yield young youth blaze " +
    "brine chime cider crisp dwell ember flare gauge haven ivory joker kneel lemon " +
    "mango niche olive prism quilt raven satin tulip usher vigor wharf yacht zebra " +
    "amber angst bloom broth cameo dodge eerie fjord grump hutch ionic jolly knack " +
    "lodge mirth nudge optic pixel quark rowdy scrub tango umbra vault waltz xenon " +
    "abide adorn aisle blush braid caper decoy elope fable gecko hyena inlay jewel " +
    "koala latch mocha nomad oaken plush quash relic swirl thorn udder vixen wager"
  ).split(/\s+/).filter(Boolean);

  // Deduplicate answers while preserving order.
  const seen = new Set();
  const answers = [];
  for (const w of ANSWERS) {
    if (w.length === 5 && !seen.has(w)) { seen.add(w); answers.push(w); }
  }

  const EXTRA_VALID = (
    "aback abaft abhor abode abbot ached aches acids acorn acres addle adept adieu " +
    "aged agile aglow ahoy ailed aimed aired aisle alder algae alias allot aloft " +
    "aloof amass amble amend amiss ample amply amuck angst antic anvil aorta apron " +
    "arbor ardor argon aroma arrow ascot ashen aspic assay aster astir atlas atoll " +
    "attic augur aunty aviud avert avian awash awful awoke axial axiom axion azure " +
    "bacon badge bagel bairn baler balmy banal banjo barge baron basil baste bated " +
    "bayou beady beech befit began begat beget belie belle belly bezel bidet bilge " +
    "bison bloat blobs bluer bluff blunt blurb blurt boozy borax bosom botch bough " +
    "boxer brace brash brawl brawn breach briar bribe brine broil broke bronco brood " +
    "brook broom brunt buddy budge buggy bugle bulge bulky bully bumpy bunny buxom " +
    "bylaw cacao cache cacti caddy cadet cagey cairo cameo canal candy caned canny " +
    "canoe caper carat cargo carol carve caste cater cavil cease cedar chafe chalk " +
    "champ chant chard charm chard chasm cheek cheer chess chews chick chide chili " +
    "chill chime chink chirp chock choke chomp chord chore chuck chugs chump chunk " +
    "churn chute cider cinch civic clack clad clamp clang clank clasp cleat cleft " +
    "clerk cling clink cloak clomp clone cloth cloud clout clove clump clung coax " +
    "cobra cocoa colon comet comfy comma conch condo coral corny couch cough coupe " +
    "cower coyly crack craft cramp crane crank crass crate crave crawl craze creak " +
    "credo creed creek creep creme crepe crept cress crest crick crimp croak croft " +
    "crone crony crook croon crumb crypt cubic cumin curio curly curry curse curvy " +
    "cynic dandy datum daunt dazed deary decal decay decor decoy defer deign deity " +
    "delta demon denim dense depot derby deter devil diary dicey digit dimly diner " +
    "dingo dingy ditch ditto ditty divan divvy dizzy dodgy dogma doily doled dolly " +
    "donor donut dopey dowdy dowel downy dowry dozen drape drawl dread dryer dryly " +
    "ducat duchy dully dummy dumpy dunce dusky dusty dutch dwarf dwelt eaten ebony " +
    "eclat edict eerie egret eider eking elbow elder elect elfin elope elude elute " +
    "elver embed ember emcee endow ennui envoy epoch epoxy equip erode erupt ethic " +
    "ethos evade evict evoke exalt excel exert exile expel extol exude eying fable " +
    "facet faded fairy faith fakir fancy farce fatal fated fatty fauna favor feign " +
    "feint felon femur fence feral ferry fetal fetch fetid feign fiber fibre ficus " +
    "fiend fiery fifes filch filet filly filmy filth finch fiord fjord flack flail " +
    "flair flake flaky flank flare flask flaxen fleck fleet flick flier flimsy fling " +
    "flint flirt flock flora floss flout flown fluff fluke flume flung flunk flush " +
    "flute foamy foist folio folly foray forge forgo forte forty fount foyer freak " +
    "frisk fritz frizz frock frond frost froth frown froze fudge fugue fully fungi " +
    "funky furor fussy fuzzy gaffe gaily gamut gaudy gauge gaunt gauze gavel gawky " +
    "gecko genie genre ghoul giddy girth given gizmo glade gland glaze gleam glean " +
    "glide glint gloat gloom gloss glyph gnash gnome godly gonad goner gonna gooey " +
    "goose gorge gouge gourd grail graph grasp grate gravy graze grime grimy grind " +
    "gripe groan groin groom grope group grout grove growl grubby gruel gruff grunt " +
    "guano guava guile guilt guise gulch gully gumbo gunny guppy gushy gusto gusty " +
    "gutsy gypsy hardy harem hasty hatch hater haunt haute haven havoc hazel heady " +
    "heath heave hedge hefty heist helix herbs heron hertz hewer hitch hoard hoary " +
    "hobby hoist holly homer honey hooch hoser hound hovel hover howdy hubby humid " +
    "humph humus hunch hunky hurl husky hutch hydro hymen hyoid hyper idiom idiot " +
    "idler igloo iliac imbue impel imply inane inbox incur infer ingot inept inert " +
    "inlay inlet inner input inter irate irked irony islet itchy ivory jabot jaunt " +
    "jazzy jelly jenny jerky jetty jewel jiffy jihad jingo jocks joist joule joust " +
    "jowls judgy juice juicy jumbo junco junky junta juror kabob kapok karma kayak " +
    "kazoo kebab kefir kelpie keyed khaki kiosk kited kitty knack knave knead kneel " +
    "knell knife knoll knurl koala kraut krill kudos labor laden ladle lager lanky " +
    "lapel larva lasso later latex lathe laud lauds leach leafy leaky leant leapt " +
    "ledge leech leery leggy lemur levee liege lifer lilac limbo limey lined liner " +
    "lingo lipid lithe livid llama loath lobby lofty logic loony loopy loris lotus " +
    "louse lousy lover lowly loyal lucid lumen lumpy lunar lupin lurch lurid lusty " +
    "lymph lynch lyric macaw macho madam madly mafia maize mamba mamba mange mango " +
    "mangy manor maple march mason matte mauve maxim mealy meaty mecca medic melee " +
    "melon mercy merge meaty mesh mocha modal moggy moist molar moldy momma mommy " +
    "moody moose moped mopey moral morph mossy motif motto mould moult mound mourn " +
    "mousy moxie mucus muddy mulch mummy mumps mural murky mushy musty muted myrrh " +
    "nadir naive nanny nappy nasal natal naval navel nerdy nerve newer newly nicer " +
    "niece nifty ninja ninth nippy nomad noose north nosey notch nudge nutty nylon " +
    "nymph oaken oasis oaten obese oboe ochre octet odder odium okapi olden ombre " +
    "onset oomph opine opium opted optic orbit organ osier ought ounce ousts outdo " +
    "outer ovary ovate overt ovine ovoid owlet owner oxide ozone paced paddy padre " +
    "pagan palsy panda pansy papal parka parry pasta pasty patio patsy payee payer " +
    "peach pearl pecan pedal penal penne peony perch perky perry pesky pesto petal " +
    "petty pewee pewter phlox picky piety piggy pinch piney pinky piqued pique pithy " +
    "pivot pixie pizza plaid plait plank plaza pleat plied plier plonk pluck plumb " +
    "plume plump plush poesy poise poker polar polka polyp pooch poppy porch poser " +
    "posit posse potty pouch pouty prank prawn preen prick pride primp privy prong " +
    "prose prowl proxy prude prune psalm pubic pudgy puffy pulpy pulse punky pupal " +
    "pupil puree purer purge purse pushy pygmy pylon quack quaff quail quake qualm " +
    "quart quash quasi quays quell query quest queue quill quirk quota quoth radar " +
    "radii rainy rajah rally ramen ranch randy raspy ratty raven rayon razor rebar " +
    "rebel rebus rebut recap recur recut redid reedy refit rehab reign relic relax " +
    "remit renal repay repel resin retch retro retry reuse rhino rhyme ridge rifle " +
    "riper risen risky ritzy roach roast robed robot rodeo rogue roomy roost rotor " +
    "rouge rouse route rowdy rugby ruler rumba rummy runny rusty saber sable sadly " +
    "safer saint salad sally salon salsa salty salve salvo sandy saner sappy saree " +
    "sassy satin satyr sauce saucy sauna savor savvy scald scalp scaly scamp scant " +
    "scare scarf scary scoff scold scone scoop scoot scorn scour scowl scram scrap " +
    "scree screw scrub scrum scuba sedan seedy semen sepia serif serum shack shale " +
    "shalt shame shank shard shave shawl sheen sheik shied shill shims shine shiny " +
    "shirk shoal shoat shone shook shorn shove shown showy shrub shrug shuck shunt " +
    "shush shyly sidle siege sieve silky silly silty since sinew singe siren sissy " +
    "sixty skate skein skew skid skiff skimp skirt skulk skull skunk slack slain " +
    "slang slant slash slate sleek sleet slept slick slime slimy sling slink sloop " +
    "slope slosh sloth slump slung slunk slurp slush slyly smack smear smelt smirk " +
    "smite smith smock smote snack snafu snail snake snare snarl sneak sneer snide " +
    "sniff snipe snoop snore snort snout snowy snuck snuff soapy sober soggy solar " +
    "solo sonic sooth sooty sorry sowed spade spank spark spasm spawn spear speck " +
    "spelt spend spent sperm spice spicy spied spiel spike spiky spilt spine spiny " +
    "spire splat splay spoil spool spoon spore sprat spray sprig spun spur spurn " +
    "spurt squad squat squib stack staid stain stair stalk stall stamp stand stank " +
    "stark stash stave stead steak steed steep steer stein stilt sting stink stint " +
    "stoic stoke stole stomp stony stoop stork stout stove stowed strap straw stray " +
    "strut stump stung stunk stunt suave sulky sully sumac sunny surer surly swami " +
    "swamp swash swath sward swarm swash swear sweat swede swell swept swift swill " +
    "swine swing swipe swirl swish swoon swoop sword swore sworn swung synod syrup " +
    "tabby taboo tacit tacky taffy taint taken taker tally talon tamer tango tangy " +
    "taper tapir tardy taunt tawny tease teddy tempo tempt tenet tenor tepee tepid " +
    "terse testy thane thaw theta thigh thong thorn thumb thump thyme tiara tibia " +
    "tidal tided tiger tilde timer timid tipsy titan tithe toady toast today toddy " +
    "toeic tokay token tommy tonal tonga tonic torch torso torus total totem toxic " +
    "toxin trace tract tramp trash trawl tread treat tress triad tribe trice trick " +
    "trill tripe troll troop trope trout trove truce truck truer truss tryst tsars " +
    "tubby tuber tulle tumor tunic turbo tutor tweak tweed tweet twerp twine twirl " +
    "twixt tying udder ulcer ultra umbra unbar uncle uncut undid undue unfed unfit " +
    "unify unlit unmet unpin unsay unset untie unwed unzip upend upped ureter urged " +
    "usher usurp uvula vague valet valor valve vapor vaunt veery vegan velum venom " +
    "venue verge verse verve vicar video vigil vigor villa vinyl viola viper viral " +
    "visor vista vixen vocal vodka vogue voile voter vouch vowel vroom vying wacky " +
    "wafer waged wager wagon waist waive waltz waned wares warty washy waspy waver " +
    "waxen weald weary weave webby wedge weedy weepy welsh welch wench whack whale " +
    "wharf wheat wheel whelp whiff whine whiny whirl whisk whist white whity whole " +
    "whoop whorl widen wider widow width wield wight wimpy wince winch windy wined " +
    "wiper wired wiser wispy witch withe witty wooer wooly woozy wordy works world " +
    "wormy worse worst wound woven wrack wrath wreak wreck wrest wring wrist writ " +
    "wrung wryly xerox xylem yacht yahoo yearn yeast yield yodel yokel yolky young " +
    "yummy zappy zebra zesty zilch zippy zonal zonked"
  ).split(/\s+/).filter(Boolean);

  const valid = new Set(answers);
  for (const w of EXTRA_VALID) {
    if (w.length === 5) valid.add(w);
  }

  global.WORDLE_WORDS = {
    answers: answers,
    isValid: function (w) { return valid.has(w); }
  };
})(typeof window !== "undefined" ? window : this);

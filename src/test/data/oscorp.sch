<?xml version="1.0" encoding="utf-8"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" 
  xmlns:sqf="http://www.schematron-quickfix.com/validator/process"
  queryBinding="xslt2">
  <sch:let name="mySVN" value="'$Id: oscorp.sch 46047 2022-09-25 10:31:55Z syd $'"/>

  <sch:title>overlap solution check or repair process</sch:title>

  <!--
    Written summer 2022 by Syd Bauman
    Copyleft 2022 Syd Bauman and the Northeastern University Women Writers Project
    
    This is a set of Schematron constrains designed to help encoders find & fix errors
    in the use of @next & @prev and in the use of @part.
  -->

  <sch:ns uri="http://www.tei-c.org/ns/1.0" prefix="tei"/>
  
  <!--
    Test pattern for checking all @part values at once; the basic idea is to ensure
    that any I, M, or F is in a sequence that starts with an I, then has any number
    of Ms, then an F.
  -->
  <sch:let name="part_pattern" value="'^([YN]*(IM*F)*)+[YN]*$'"/>
  
  <!-- Repairs: @next & @prev -->
  <sqf:fixes>
    <sqf:fix id="notpreved">
      <sqf:description>
        <sqf:title>Point at me with a @prev</sqf:title>
        <sqf:p>Add a @prev that points to me to the element I point to with @next</sqf:p>
      </sqf:description>
      <sch:let name="next" value="id( substring(@next,2) )"/>
      <sch:let name="ptr2me" value="concat('#', @xml:id )"/>
      <sqf:add target="prev" node-type="attribute" match="$next" select="$ptr2me"/>
    </sqf:fix>
    <sqf:fix id="notnexted">
      <sqf:description>
        <sqf:title>Point at me with a @next</sqf:title>
        <sqf:p>Add a @next that points to me to the element I point to with @prev</sqf:p>
      </sqf:description>
      <sch:let name="prev" value="id( substring(@prev,2) )"/>
      <sch:let name="ptr2me" value="concat('#', @xml:id )"/>
      <sqf:add target="next" node-type="attribute" match="$prev" select="$ptr2me"/>
    </sqf:fix>
    <sqf:fix id="nextless">
      <sqf:description>
        <sqf:title>Add missing @next</sqf:title>
        <sqf:p>For an element that is pointed to by a @prev but does not have an @next, add the @next</sqf:p>
      </sqf:description>
      <sch:let name="myID" value="@xml:id"/>
      <sqf:add node-type="attribute" target="next" select="concat('#',//*[@prev/normalize-space(.) eq concat('#',$myID)][1]/@xml:id)"/>
    </sqf:fix>
    <sqf:fix id="prevless">
      <sqf:description>
        <sqf:title>Add missing @prev</sqf:title>
        <sqf:p>For an element that is pointed to by a @next but does not have an @prev, add the @prev</sqf:p>
      </sqf:description>
      <sch:let name="myID" value="@xml:id"/>
      <sqf:add node-type="attribute" target="prev" select="concat('#',//*[@next/normalize-space(.) eq concat('#',$myID)][1]/@xml:id)"/>
    </sqf:fix>
  </sqf:fixes>
  
  <sch:pattern id="both-next-and-prev">
    <sch:rule context="*[@xml:id]">
      <sch:let name="isAprev" value="//@prev/normalize-space(.) = concat('#',@xml:id)"/>
      <sch:let name="isAnext" value="//@next/normalize-space(.) = concat('#',@xml:id)"/>
      <sch:report test="@next and not( $isAprev )" sqf:fix="notpreved">Element <sch:value-of select="@xml:id"/> has a next= but is not pointed at by a prev=</sch:report>
      <sch:report test="@prev and not( $isAnext )" sqf:fix="notnexted">Element <sch:value-of select="@xml:id"/> has a prev= but is not pointed at by a next=</sch:report>
      <sch:report test="not( @next ) and $isAprev" sqf:fix="nextless" >Element <sch:value-of select="@xml:id"/> is pointed at by a prev= but does not have a next=</sch:report>
      <sch:report test="not( @prev ) and $isAnext" sqf:fix="prevless" >Element <sch:value-of select="@xml:id"/> is pointed at by a next= but does not have a prev=</sch:report>
    </sch:rule>
  </sch:pattern>
  
  <sch:pattern id="next-prev-point-appropriately">
    <!-- Note: this constraint may not work with `probatron`, but works fine in oXygen. -->
    <sch:rule context="@prev|@next">
      <!-- basics: -->
      <sch:let name="element" value=".."/>
      <sch:let name="me" value="normalize-space(.)"/>
      <sch:let name="ptr" value="if ( starts-with( $me,'#') ) then substring-after( $me,'#') else 'ERROR!?!'"/>
      <!-- tests: -->
      <sch:let name="hasSpace" value="contains( $me,' ')"/>
      <sch:let name="points2local" value="exists( id( $ptr ) )"/>
      <sch:let name="points2same" value="id( $ptr ) is $element"/>
      <sch:let name="points2sameGI" value="name( $element ) eq name( id( $ptr ) )"/>
      <sch:let name="pointsAfter" value="id( $ptr ) &gt;&gt; $element"/>
      <sch:let name="pointsBefore" value="$element &gt;&gt; id( $ptr )"/>
      <!-- message: -->
      <sch:let name="msg_part_1"
        value="concat(
                      '@',
                      name(.),
                      ' of ＜',
                      name( $element ),
                      '＞ ',
                      if (../@xml:id)
                        then concat('(with @xml:id &#34;', ../@xml:id,'&#34;)')
                        else ''
                     )"/>
      <sch:report test="$hasSpace"><sch:value-of select="$msg_part_1"/> has more than 1 pointer (a space in a URI should be written '%20')</sch:report>
      <sch:assert test="if ( not( $hasSpace ) ) then ( $points2local ) else true()"><sch:value-of select="$msg_part_1"/> does not point to a local element.</sch:assert>
      <sch:report test="if ( not( $hasSpace ) ) then ( $points2same ) else false()"><sch:value-of select="$msg_part_1"/> points to itself.</sch:report>
      <sch:assert test="if ( not( $hasSpace ) and $points2local ) then ( $points2sameGI ) else true()"><sch:value-of select="$msg_part_1"/> points to a ＜<sch:value-of select="name( id( $ptr ) )"/>＞ (it should point to another ＜<sch:value-of select="name( $element )"/>＞).</sch:assert>
      <sch:assert test="if ( not( $hasSpace ) and $points2local and local-name(.) eq 'prev' and not( $points2same ) ) then ( $pointsBefore ) else 'true()'"><sch:value-of select="$msg_part_1"/> points to a ＜<sch:value-of select="name( id( $ptr ) )"/>＞ that is after itself.</sch:assert>
      <sch:assert test="if ( not( $hasSpace ) and $points2local and local-name(.) eq 'next' and not( $points2same ) ) then ( $pointsAfter ) else 'true()'"><sch:value-of select="$msg_part_1"/> points to a ＜<sch:value-of select="name( id( $ptr ) )"/>＞ that is prior to itself.</sch:assert>
    </sch:rule>
  </sch:pattern>

  <!-- @part inside @part problems -->
  <sch:pattern>
    <sch:rule context="*[@part][descendant::*[@part]]">
      <sch:let name="myName" value="name(.)"/>
      <sch:let name="myID" value="( @xml:id, '' )[1]"/>
      <sch:report test="descendant::*[@part]!name(.) = $myName">
        ERROR: this ＜<sch:value-of select="$myName"/>＞ (<sch:value-of
          select="if (@xml:id)
                  then concat('id=',@xml:id)
                  else concat('number ', count( (preceding::*|ancestor-or-self::*)[name(.) eq $myName] ) )"/>) has a @part attribute *and* a descendant ＜<sch:value-of select="$myName"/>＞ that also has @part!
      </sch:report>
    </sch:rule>
  </sch:pattern>
  
  <sch:pattern id="IMFs">
    <!--
        Fire only on <text> elements that are a child of outermost <TEI> and actually
        have a @part to avoid
        a) repeat error messages from a <text> nested inside the <text> that is a child
           of the outermost <TEI> (i.e., from cases of TEI/text/group/text);
        a) having to worry about the empty string as a value of $IMFs; and
        b) wasting time looking for @parts that are not there.
      -->
    <sch:rule context="/*/tei:text[.//@part]">
      <!-- Generate string of all of ’em in a row: -->
      <sch:let name="IMFs" value="string-join( .//@part!normalize-space(.) )"/>
      <!-- When showing that string to user insert commas between “blocks” to make more readable: -->
      <sch:let name="IMFs_for_msg" value="replace( $IMFs, 'FI','F,I')"/>
      <!-- Test that string matches required pattern, error if it does not: -->
      <sch:assert test="matches( $IMFs, $part_pattern )" role="warn">Something appears wrong with your sequence of @part attributes (which is “<sch:value-of select="$IMFs_for_msg"/>”). More precise error messages may also be emitted.</sch:assert>
      <!-- Test that string matches required pattern, just let user know all is OK if it does: (This is as much for debugging … -->
      <sch:report test="matches( $IMFs, $part_pattern )" role="info" >I just thought you would like to know your @part values are “<sch:value-of select="$IMFs_for_msg"/>”.</sch:report>
    </sch:rule>
  </sch:pattern>
  
  <!-- Check that @part aggregate elements are in order (i.e., IM*F, Mr. Phelps) -->
  <sch:pattern id="IMF_from_I">
    <sch:rule context="*[@part eq 'I']">
      <!-- This pattern checks from I, and thus will not catch IMFF, IMFM, etc. -->
      <sch:let name="myName" value="name(.)"/>
      <!-- sequence of all the following instances of this element type: -->
      <sch:let name="FOLLOWs" value="following::*[name(.) eq $myName]"/>
      <!-- first one of those that has part=F: -->
      <sch:let name="Final" value="$FOLLOWs[ @part eq 'F' ][1]"/>
      <!-- sequence of all the following instances of this element type that come before the one with part=F: -->
      <sch:let name="MEDIALs" value="$FOLLOWs[ $Final >> . ]"/>
      <!-- Some variables to make things shorter: -->
      <sch:let name="label" value="if (@xml:id)
                                   then concat('id=',@xml:id)
                                   else concat('number ', count( (preceding::*|ancestor-or-self::*)[name(.) eq $myName] ) )"/>
      <sch:let name="msg_start" value="concat('This ＜', $myName, '＞ (', $label, ') has part=I, but')"/>
      <!-- If there are no following elements of same type, this _can’t_ be right: -->
      <sch:assert test="$FOLLOWs">
        <sch:value-of select="$msg_start"/> there is no following ＜<sch:value-of select="$myName"/>＞ element.
      </sch:assert>
      <sch:assert test="$Final">
        <sch:value-of select="$msg_start"/> there is no following ＜<sch:value-of select="$myName"/>＞ element with part=F.
      </sch:assert>
      <sch:assert test="every $m in $MEDIALs satisfies $m/@part eq 'M'">
        <sch:value-of select="$msg_start"/> one or more of the ＜<sch:value-of select="$myName"/>＞ between it and the part=F do not have part=M.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <sch:pattern id="IMF_from_M">
    <sch:rule context="*[@part eq 'M']">
      <!-- This pattern checks from M, and thus will not catch IIMF, IMFF, etc. -->
      <sch:let name="myName" value="name(.)"/>
      <!-- sequence of all the preceding instances of this element type: -->
      <sch:let name="PRECEDEs" value="preceding::*[name(.) eq $myName]"/>
      <!-- closest one of those that has part=I: -->
      <sch:let name="Initial" value="$PRECEDEs[ @part eq 'I' ][last()]"/>
      <!-- sequence of all the preceding instances of this element type that come after the one with part=I: -->
      <!-- sequence of all the following instances of this element type: -->
      <sch:let name="FOLLOWs" value="following::*[name(.) eq $myName]"/>
      <!-- first one of those that has part=F: -->
      <sch:let name="Final" value="$FOLLOWs[ @part eq 'F' ][1]"/>
      <!--
        sequence of all the following instances of this element type that come before the one with part=F,
        and all of the preceding instances of this element type that come after the one with part=I.
      -->
      <sch:let name="MEDIALs" value="$FOLLOWs[ $Final >> . ] | $PRECEDEs[ . >> $Initial ]"/>
      <!-- Some variables to make things shorter: -->
      <sch:let name="label" value="if (@xml:id)
        then concat('id=',@xml:id)
        else concat('number ', count( (preceding::*|ancestor-or-self::*)[name(.) eq $myName] ) )"/>
      <sch:let name="msg_start" value="concat('This ＜', $myName, '＞ (', $label, ') has part=M, but')"/>
      <!-- If there are no preceding elements of same type, this _can’t_ be right: -->
      <sch:assert test="$PRECEDEs">
        <sch:value-of select="$msg_start"/> there is no preceding ＜<sch:value-of select="$myName"/>＞ element.
      </sch:assert>
      <!-- If there are no following elements of same type, this _can’t_ be right: -->
      <sch:assert test="$FOLLOWs">
        <sch:value-of select="$msg_start"/> there is no following ＜<sch:value-of select="$myName"/>＞ element.
      </sch:assert>
      <sch:assert test="$Initial">
        <sch:value-of select="$msg_start"/> there is no preceding ＜<sch:value-of select="$myName"/>＞ element with part=I.
      </sch:assert>
      <sch:assert test="$Final">
        <sch:value-of select="$msg_start"/> there is no following ＜<sch:value-of select="$myName"/>＞ element with part=F.
      </sch:assert>
      <sch:assert test="every $m in $MEDIALs satisfies $m/@part eq 'M'">
        <sch:value-of select="$msg_start"/> one or more of the ＜<sch:value-of select="$myName"/>＞ between it and either the part=I or the part=F do not have part=M.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

  <sch:pattern id="IMF_from_F">
    <sch:rule context="*[@part eq 'F']">
      <!-- This pattern checks from F, and thus will not catch IIMF, MIMF, etc. -->
      <sch:let name="myName" value="name(.)"/>
      <!-- sequence of all the preceding instances of this element type: -->
      <sch:let name="PRECEDEs" value="preceding::*[name(.) eq $myName]"/>
      <!-- closest one of those that has part=I: -->
      <sch:let name="Initial" value="$PRECEDEs[ @part eq 'I' ][last()]"/>
      <!-- sequence of all the preceding instances of this element type that come after the one with part=I: -->
      <sch:let name="MEDIALs" value="$PRECEDEs[ . >> $Initial ]"/>
      <!-- Some variables to make things shorter: -->
      <sch:let name="label" value="if (@xml:id)
        then concat('id=',@xml:id)
        else concat('number ', count( (preceding::*|ancestor-or-self::*)[name(.) eq $myName] ) )"/>
      <sch:let name="msg_start" value="concat('This ＜', $myName, '＞ (', $label, ') has part=F, but')"/>
      <!-- If there are no preceding elements of same type, this _can’t_ be right: -->
      <sch:assert test="$PRECEDEs">
        <sch:value-of select="$msg_start"/> there is no preceding ＜<sch:value-of select="$myName"/>＞ element.
      </sch:assert>
      <sch:assert test="$Initial">
        <sch:value-of select="$msg_start"/> there is no preceding ＜<sch:value-of select="$myName"/>＞ element with part=I.
      </sch:assert>
      <sch:assert test="every $m in $MEDIALs satisfies $m/@part eq 'M'">
        <sch:value-of select="$msg_start"/> one or more of the ＜<sch:value-of select="$myName"/>＞ between it and the part=I do not have part=M.
      </sch:assert>
    </sch:rule>
  </sch:pattern>

</sch:schema>

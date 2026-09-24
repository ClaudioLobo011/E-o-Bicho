param([Parameter(Mandatory=$true)][string]$XmlPath, [Parameter(Mandatory=$true)][string]$SchemaPath)
$ErrorActionPreference = 'Stop'
$settings = [System.Xml.XmlReaderSettings]::new()
$settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$settings.ValidationType = [System.Xml.ValidationType]::Schema
$settings.Schemas.XmlResolver = [System.Xml.XmlUrlResolver]::new()
$signatureSchema = Join-Path (Split-Path -LiteralPath $SchemaPath) 'xmldsig-core-schema.xsd'
# O XSD oficial W3C inclui um DTD. Só esse arquivo local confiável permite
# seu subconjunto interno, sem buscar DTD ou entidades pela rede.
$signatureSettings = [System.Xml.XmlReaderSettings]::new()
$signatureSettings.DtdProcessing = [System.Xml.DtdProcessing]::Parse
$signatureSettings.XmlResolver = $null
$signatureReader = [System.Xml.XmlReader]::Create($signatureSchema, $signatureSettings)
try { $null = $settings.Schemas.Add('http://www.w3.org/2000/09/xmldsig#', $signatureReader) } finally { $signatureReader.Dispose() }
$null = $settings.Schemas.Add('http://www.sped.fazenda.gov.br/nfse', $SchemaPath)
$settings.Schemas.Compile()
$script:validationErrors = [System.Collections.Generic.List[string]]::new()
$settings.add_ValidationEventHandler({ param($sender, $eventArgs) $script:validationErrors.Add($eventArgs.Message) })
$reader = [System.Xml.XmlReader]::Create($XmlPath, $settings)
try { while ($reader.Read()) {} } finally { $reader.Dispose() }
if ($script:validationErrors.Count -gt 0) { throw ($script:validationErrors -join "`n") }
Write-Output 'XSD OK'

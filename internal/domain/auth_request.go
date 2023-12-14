package domain

import (
	"strings"
	"time"

	"golang.org/x/text/language"

	"github.com/zitadel/zitadel/internal/zerrors"
)

type AuthRequest struct {
	ID            string
	AgentID       string
	CreationDate  time.Time
	ChangeDate    time.Time
	BrowserInfo   *BrowserInfo
	ApplicationID string
	CallbackURI   string
	TransferState string
	Prompt        []Prompt
	PossibleLOAs  []LevelOfAssurance
	UiLocales     []string
	LoginHint     string
	MaxAuthAge    *time.Duration
	InstanceID    string
	Request       Request

	levelOfAssurance         LevelOfAssurance
	UserID                   string
	UserName                 string
	LoginName                string
	DisplayName              string
	AvatarKey                string
	PresignedAvatar          string
	UserOrgID                string
	RequestedOrgID           string
	RequestedOrgName         string
	RequestedPrimaryDomain   string
	RequestedOrgDomain       bool
	ApplicationResourceOwner string
	PrivateLabelingSetting   PrivateLabelingSetting
	SelectedIDPConfigID      string
	LinkingUsers             []*ExternalUser
	PossibleSteps            []NextStep `json:"-"`
	PasswordVerified         bool
	MFAsVerified             []MFAType
	Audience                 []string
	AuthTime                 time.Time
	Code                     string
	LoginPolicy              *LoginPolicy
	AllowedExternalIDPs      []*IDPProvider
	LabelPolicy              *LabelPolicy
	PrivacyPolicy            *PrivacyPolicy
	LockoutPolicy            *LockoutPolicy
	DefaultTranslations      []*CustomText
	OrgTranslations          []*CustomText
	SAMLRequestID            string
}

type ExternalUser struct {
	IDPConfigID       string
	ExternalUserID    string
	DisplayName       string
	PreferredUsername string
	FirstName         string
	LastName          string
	NickName          string
	Email             EmailAddress
	IsEmailVerified   bool
	PreferredLanguage language.Tag
	Phone             PhoneNumber
	IsPhoneVerified   bool
	Metadatas         []*Metadata
}

type Prompt int32

const (
	PromptUnspecified Prompt = iota
	PromptNone
	PromptLogin
	PromptConsent
	PromptSelectAccount
	PromptCreate
)

func IsPrompt(prompt []Prompt, requestedPrompt Prompt) bool {
	for _, p := range prompt {
		if p == requestedPrompt {
			return true
		}
	}
	return false
}

type LevelOfAssurance int

const (
	LevelOfAssuranceNone LevelOfAssurance = iota
)

type MFAType int

const (
	MFATypeTOTP MFAType = iota
	MFATypeU2F
	MFATypeU2FUserVerification
	MFATypeOTPSMS
	MFATypeOTPEmail
)

type MFALevel int

const (
	MFALevelNotSetUp MFALevel = iota
	MFALevelSecondFactor
	MFALevelMultiFactor
	MFALevelMultiFactorCertified
)

type AuthRequestState int

const (
	AuthRequestStateUnspecified AuthRequestState = iota
	AuthRequestStateAdded
	AuthRequestStateCodeAdded
	AuthRequestStateCodeExchanged
	AuthRequestStateFailed
	AuthRequestStateSucceeded
)

func NewAuthRequestFromType(requestType AuthRequestType) (*AuthRequest, error) {
	switch requestType {
	case AuthRequestTypeOIDC:
		return &AuthRequest{Request: &AuthRequestOIDC{}}, nil
	case AuthRequestTypeSAML:
		return &AuthRequest{Request: &AuthRequestSAML{}}, nil
	case AuthRequestTypeDevice:
		return &AuthRequest{Request: &AuthRequestDevice{}}, nil
	}
	return nil, zerrors.ThrowInvalidArgument(nil, "DOMAIN-ds2kl", "invalid request type")
}

func (a *AuthRequest) WithCurrentInfo(info *BrowserInfo) *AuthRequest {
	a.BrowserInfo = info
	return a
}

func (a *AuthRequest) SetUserInfo(userID, userName, loginName, displayName, avatar, userOrgID string) {
	a.UserID = userID
	a.UserName = userName
	a.LoginName = loginName
	a.DisplayName = displayName
	a.AvatarKey = avatar
	a.UserOrgID = userOrgID
}

func (a *AuthRequest) SetOrgInformation(id, name, primaryDomain string, requestedByDomain bool) {
	a.RequestedOrgID = id
	a.RequestedOrgName = name
	a.RequestedPrimaryDomain = primaryDomain
	a.RequestedOrgDomain = requestedByDomain
}

func (a *AuthRequest) MFALevel() MFALevel {
	return -1
	//PLANNED: check a.PossibleLOAs (and Prompt Login?)
}

func (a *AuthRequest) AppendAudIfNotExisting(aud string) {
	for _, a := range a.Audience {
		if a == aud {
			return
		}
	}
	a.Audience = append(a.Audience, aud)
}

func (a *AuthRequest) GetScopeOrgPrimaryDomain() string {
	switch request := a.Request.(type) {
	case *AuthRequestOIDC:
		for _, scope := range request.Scopes {
			if strings.HasPrefix(scope, OrgDomainPrimaryScope) {
				return strings.TrimPrefix(scope, OrgDomainPrimaryScope)
			}
		}
	}
	return ""
}

func (a *AuthRequest) GetScopeOrgID() string {
	switch request := a.Request.(type) {
	case *AuthRequestOIDC:
		for _, scope := range request.Scopes {
			if strings.HasPrefix(scope, OrgIDScope) {
				return strings.TrimPrefix(scope, OrgIDScope)
			}
		}
	}
	return ""
}

func (a *AuthRequest) Done() bool {
	for _, step := range a.PossibleSteps {
		if step.Type() == NextStepRedirectToCallback {
			return true
		}
	}
	return false
}

func (a *AuthRequest) PrivateLabelingOrgID(defaultID string) string {
	if a.RequestedOrgID != "" {
		return a.RequestedOrgID
	}
	if (a.PrivateLabelingSetting == PrivateLabelingSettingAllowLoginUserResourceOwnerPolicy || a.PrivateLabelingSetting == PrivateLabelingSettingUnspecified) &&
		a.UserOrgID != "" {
		return a.UserOrgID
	}
	if a.PrivateLabelingSetting != PrivateLabelingSettingUnspecified {
		return a.ApplicationResourceOwner
	}
	return defaultID
}
